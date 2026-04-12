/**
 * Provider-agnostic model adapter interface.
 *
 * This is the only place in the codebase where the model is referenced.
 * Everything else talks to this interface. Swap the adapter to switch providers.
 *
 * Autodiscovery: checks ANTHROPIC_API_KEY first, then OPENAI_API_KEY.
 * Errors clearly if neither is present.
 */

import type { Message, AssistantResponse, TokenUsage, ToolUseBlock, MessageContent } from '../types.js'
import { NoModelKeyError } from './errors.js'

// ---------------------------------------------------------------------------
// Retry helper — handles 429, 500, 502, 503, 529 with exponential backoff
// ---------------------------------------------------------------------------

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529])
const MAX_RETRIES = 3
const BASE_DELAY_MS = 1_000

async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<Response> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s, 4s
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1)
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    let response: Response
    try {
      response = await fetch(url, init)
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt === MAX_RETRIES) break
      continue
    }

    if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_RETRIES) {
      return response
    }

    // Respect Retry-After header if present
    const retryAfter = response.headers.get('Retry-After')
    if (retryAfter) {
      const seconds = parseFloat(retryAfter)
      if (!isNaN(seconds)) {
        await new Promise(resolve => setTimeout(resolve, seconds * 1_000))
      }
    }
  }

  throw lastError ?? new Error('Request failed after retries')
}

// ---------------------------------------------------------------------------
// Tool definition — what the model sees
// ---------------------------------------------------------------------------

export type ToolDefinition = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ---------------------------------------------------------------------------
// Model adapter interface
// ---------------------------------------------------------------------------

export type ModelChatParams = {
  messages: Message[]
  systemPrompt: string
  tools?: ToolDefinition[]
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export type ModelChatEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_delta'; id: string; inputDelta: string }
  | { type: 'message_complete'; response: AssistantResponse }
  | { type: 'error'; error: Error }

/**
 * Implement this interface to connect any model to the agent loop.
 */
export interface ModelAdapter {
  /** Provider name — for logging and display */
  readonly provider: string

  /** Default model identifier */
  readonly defaultModel: string

  /** Estimate token count for a string (can use a heuristic) */
  countTokens(text: string): number

  /**
   * Stream a chat completion.
   * Must yield a `message_complete` event as the final event.
   */
  chat(params: ModelChatParams): AsyncGenerator<ModelChatEvent>
}

// ---------------------------------------------------------------------------
// Anthropic adapter
// ---------------------------------------------------------------------------

export class AnthropicAdapter implements ModelAdapter {
  readonly provider = 'anthropic'
  readonly defaultModel: string

  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options?: { model?: string; apiKey?: string; baseUrl?: string }) {
    const key = options?.apiKey ?? process.env['ANTHROPIC_API_KEY']
    if (!key) throw new NoModelKeyError()

    this.apiKey = key
    this.defaultModel = options?.model ?? process.env['BASED_AGENT_DEFAULT_MODEL'] ?? 'claude-3-5-sonnet-20241022'
    this.baseUrl = options?.baseUrl ?? 'https://api.anthropic.com'
  }

  countTokens(text: string): number {
    // Rough estimate: ~4 chars per token. Replace with tiktoken for accuracy.
    return Math.ceil(text.length / 4)
  }

  async *chat(params: ModelChatParams): AsyncGenerator<ModelChatEvent> {
    const { messages, systemPrompt, tools, maxTokens = 8192, signal } = params

    const body = {
      model: this.defaultModel,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: messages.map(msg => ({
        role: msg.role,
        content: msg.content,
      })),
      ...(tools && tools.length > 0 ? {
        tools: tools.map(t => ({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })),
      } : {}),
      stream: true,
    }

    const response = await fetchWithRetry(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Anthropic API error ${response.status}: ${error}`)
    }

    if (!response.body) throw new Error('No response body')

    // Parse SSE stream
    const content: MessageContent[] = []
    const toolUses: ToolUseBlock[] = []
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let stopReason: AssistantResponse['stopReason'] = 'end_turn'
    let currentToolInput = ''
    let currentToolId = ''
    let currentToolName = ''
    let accumulatedText = '' // accumulate text deltas into one block

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          let event: Record<string, unknown>
          try {
            event = JSON.parse(data) as Record<string, unknown>
          } catch {
            continue
          }

          switch (event['type']) {
            case 'content_block_start': {
              const block = event['content_block'] as { type: string; id?: string; name?: string } | undefined
              if (block?.type === 'tool_use') {
                // Flush any accumulated text before a tool block
                if (accumulatedText) {
                  content.push({ type: 'text', text: accumulatedText })
                  accumulatedText = ''
                }
                currentToolId = block.id ?? ''
                currentToolName = block.name ?? ''
                currentToolInput = ''
                yield { type: 'tool_use_start', id: currentToolId, name: currentToolName }
              }
              break
            }
            case 'content_block_delta': {
              const delta = event['delta'] as { type: string; text?: string; partial_json?: string } | undefined
              if (delta?.type === 'text_delta' && delta.text) {
                accumulatedText += delta.text
                yield { type: 'text_delta', text: delta.text }
              } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
                currentToolInput += delta.partial_json
                yield { type: 'tool_use_delta', id: currentToolId, inputDelta: delta.partial_json }
              }
              break
            }
            case 'content_block_stop': {
              if (currentToolId) {
                let parsedInput: unknown = {}
                try { parsedInput = JSON.parse(currentToolInput) } catch { /* ignore */ }

                toolUses.push({ id: currentToolId, name: currentToolName, input: parsedInput })
                content.push({ type: 'tool_use', id: currentToolId, name: currentToolName, input: parsedInput })
                currentToolId = ''
                currentToolName = ''
                currentToolInput = ''
              } else if (accumulatedText) {
                // Text block ended — flush accumulated text
                content.push({ type: 'text', text: accumulatedText })
                accumulatedText = ''
              }
              break
            }
            case 'message_delta': {
              const delta = event['delta'] as { stop_reason?: string } | undefined
              if (delta?.stop_reason) {
                stopReason = (delta.stop_reason as AssistantResponse['stopReason']) ?? 'end_turn'
              }
              const usage = event['usage'] as { output_tokens?: number } | undefined
              if (usage?.output_tokens) outputTokens = usage.output_tokens
              break
            }
            case 'message_start': {
              const msg = event['message'] as { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } | undefined
              inputTokens = msg?.usage?.input_tokens ?? 0
              cacheReadTokens = msg?.usage?.cache_read_input_tokens ?? 0
              cacheWriteTokens = msg?.usage?.cache_creation_input_tokens ?? 0
              break
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // Flush any remaining accumulated text
    if (accumulatedText) {
      content.push({ type: 'text', text: accumulatedText })
    }

    const usage: TokenUsage = { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
    yield {
      type: 'message_complete',
      response: { content, toolUses, stopReason, usage },
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI adapter
// ---------------------------------------------------------------------------

export class OpenAIAdapter implements ModelAdapter {
  readonly provider = 'openai'
  readonly defaultModel: string

  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(options?: { model?: string; apiKey?: string; baseUrl?: string }) {
    const key = options?.apiKey ?? process.env['OPENAI_API_KEY']
    if (!key) throw new NoModelKeyError()

    this.apiKey = key
    this.defaultModel = options?.model ?? process.env['BASED_AGENT_DEFAULT_MODEL'] ?? 'gpt-4o'
    this.baseUrl = options?.baseUrl ?? 'https://api.openai.com'
  }

  countTokens(text: string): number {
    return Math.ceil(text.length / 4)
  }

  async *chat(params: ModelChatParams): AsyncGenerator<ModelChatEvent> {
    const { messages, systemPrompt, tools, maxTokens = 8192, signal } = params

    // Convert messages to OpenAI format.
    // Anthropic packs tool_results into user messages; OpenAI uses separate 'tool' role messages.
    // Anthropic puts tool_use in assistant messages; OpenAI uses tool_calls on the assistant message.
    // OpenAI message union — each branch must conform to one of these shapes
    type OpenAIMessage =
      | { role: 'system'; content: string }
      | { role: 'user'; content: string }
      | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
      | { role: 'tool'; tool_call_id: string; content: string }

    const openAIMessages: OpenAIMessage[] = [
      { role: 'system', content: systemPrompt },
      ...messages.flatMap((msg): OpenAIMessage[] => {
        // tool_result messages (user role in our format) → role:'tool' in OpenAI format
        if (msg.role === 'user' && msg.content.some(c => c.type === 'tool_result')) {
          return msg.content
            .filter(c => c.type === 'tool_result')
            .map(c => ({
              role: 'tool' as const,
              tool_call_id: (c as { tool_use_id: string }).tool_use_id,
              content: (c as { content: string }).content ?? '',
            }))
        }

        // Assistant messages with tool_use → tool_calls on the assistant message
        if (msg.role === 'assistant') {
          const textContent = msg.content
            .filter(c => c.type === 'text')
            .map(c => (c as { text: string }).text)
            .join('') || null
          const toolUses = msg.content.filter(c => c.type === 'tool_use') as Array<{
            id: string; name: string; input: unknown
          }>

          if (toolUses.length > 0) {
            return [{
              role: 'assistant' as const,
              content: textContent,
              tool_calls: toolUses.map(tu => ({
                id: tu.id,
                type: 'function' as const,
                function: {
                  name: tu.name,
                  arguments: JSON.stringify(tu.input),
                },
              })),
            }]
          }
          return [{ role: 'assistant' as const, content: textContent ?? '' }]
        }

        // Regular user messages
        return [{
          role: 'user' as const,
          content: msg.content
            .filter(c => c.type === 'text')
            .map(c => (c as { text: string }).text)
            .join(''),
        }]
      }),
    ]


    const openAITools = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }))

    const body = {
      model: this.defaultModel,
      max_tokens: maxTokens,
      messages: openAIMessages,
      ...(openAITools && openAITools.length > 0 ? { tools: openAITools } : {}),
      stream: true,
      stream_options: { include_usage: true },
    }

    const response = await fetchWithRetry(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${error}`)
    }

    if (!response.body) throw new Error('No response body')

    const content: MessageContent[] = []
    const toolUses: ToolUseBlock[] = []
    const toolCallAccumulators: Record<string, { id: string; name: string; args: string }> = {}
    let inputTokens = 0
    let outputTokens = 0
    let stopReason: AssistantResponse['stopReason'] = 'end_turn'
    let accumulatedText = ''

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          let event: Record<string, unknown>
          try { event = JSON.parse(data) as Record<string, unknown> } catch { continue }

          const choices = event['choices'] as Array<{
            delta?: {
              content?: string
              tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }>
            }
            finish_reason?: string
          }> | undefined

          if (!choices?.[0]) continue
          const choice = choices[0]
          const delta = choice.delta

          if (delta?.content) {
            accumulatedText += delta.content
            yield { type: 'text_delta', text: delta.content }
          }

          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = String(tc.index)
              if (!toolCallAccumulators[idx]) {
                const id = tc.id ?? `call_${idx}`
                const name = tc.function?.name ?? ''
                toolCallAccumulators[idx] = { id, name, args: '' }
                yield { type: 'tool_use_start', id, name }
              }
              if (tc.function?.name && !toolCallAccumulators[idx]!.name) {
                toolCallAccumulators[idx]!.name = tc.function.name
              }
              if (tc.function?.arguments) {
                toolCallAccumulators[idx]!.args += tc.function.arguments
                yield { type: 'tool_use_delta', id: toolCallAccumulators[idx]!.id, inputDelta: tc.function.arguments }
              }
            }
          }

          if (choice.finish_reason) {
            stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn'
          }

          const usage = event['usage'] as { prompt_tokens?: number; completion_tokens?: number } | undefined
          if (usage) {
            inputTokens = usage.prompt_tokens ?? 0
            outputTokens = usage.completion_tokens ?? 0
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // Flush accumulated text
    if (accumulatedText) {
      content.push({ type: 'text', text: accumulatedText })
    }

    // Finalize tool calls — use tracked real IDs
    for (const [, acc] of Object.entries(toolCallAccumulators)) {
      let parsedInput: unknown = {}
      try { parsedInput = JSON.parse(acc.args) } catch { /* ignore */ }
      toolUses.push({ id: acc.id, name: acc.name, input: parsedInput })
      content.push({ type: 'tool_use', id: acc.id, name: acc.name, input: parsedInput })
    }

    yield {
      type: 'message_complete',
      response: { content, toolUses, stopReason, usage: { inputTokens, outputTokens } },
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-discovery factory
// ---------------------------------------------------------------------------

/**
 * Creates a model adapter based on available API keys.
 * Checks ANTHROPIC_API_KEY first, falls back to OPENAI_API_KEY.
 * Throws NoModelKeyError if neither is present.
 */
export function createModelAdapter(options?: {
  model?: string
  apiKey?: string
  provider?: 'anthropic' | 'openai'
  baseUrl?: string
}): ModelAdapter {
  if (options?.provider === 'anthropic') return new AnthropicAdapter(options)
  if (options?.provider === 'openai') return new OpenAIAdapter(options)

  // Auto-detect from environment
  if (process.env['ANTHROPIC_API_KEY']) return new AnthropicAdapter(options)
  if (process.env['OPENAI_API_KEY']) return new OpenAIAdapter(options)

  throw new NoModelKeyError()
}
