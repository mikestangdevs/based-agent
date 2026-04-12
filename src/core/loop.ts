/**
 * The agent loop.
 *
 * This is the core of the system. It drives the model ↔ tool ↔ result cycle
 * until a terminal condition is reached.
 *
 * The loop:
 * 1. Builds the current message list from history + context
 * 2. Calls the model via the adapter
 * 3. If the model requests tool calls, checks permissions and executes them
 * 4. Feeds results back into the message history
 * 5. Repeats until: end_turn, max iterations, budget exhaustion, or abort
 *
 * All state transitions are yielded as typed AgentEvents so callers can
 * observe and react to everything that happens without coupling to internals.
 */

import type { ModelAdapter } from './model-adapter.js'
import type {
  AgentEvent,
  AgentRunParams,
  Message,
  TerminationReason,
  ToolResultContent,
} from '../types.js'
import { toolResultMessage, userMessage } from '../types.js'
import type { ToolRegistry } from '../tools/index.js'
import type { PermissionPolicy } from '../permissions/index.js'
import type { MemoryContext } from '../memory/index.js'
import type { ContextManager } from '../context/index.js'
import type { PromptBuilder } from '../prompts/index.js'
import { UnknownToolError } from './errors.js'

export type AgentConfig = {
  /** Tool registry with all available tools */
  tools: ToolRegistry

  /** Permission policy for all tool calls */
  permissions: PermissionPolicy

  /** Loaded memory context */
  memory: MemoryContext

  /** Context window manager */
  context: ContextManager

  /** Prompt builder for system prompt composition */
  prompts: PromptBuilder

  /** Model adapter (Anthropic, OpenAI, or custom) */
  model: ModelAdapter

  /** Base system instructions for this agent */
  baseInstructions?: string

  /** Maximum number of loop iterations (safety valve) */
  maxIterations?: number

  /** Maximum output tokens per model call */
  maxTokens?: number

  /**
   * Working directory for all file and shell tool calls.
   * Defaults to process.cwd() if not set.
   * Override to point tools at a specific project directory.
   */
  workingDirectory?: string
}

const DEFAULT_INSTRUCTIONS = `You are a capable, focused agent. You use tools to accomplish tasks.
You prefer targeted actions over broad ones. You ask before doing anything destructive.
When a task is complete, stop — do not keep working unnecessarily.`

/**
 * Core agent loop. Returns an async generator of typed events.
 *
 * Usage:
 *   const agent = createAgent(config)
 *   for await (const event of agent.run({ task: 'Do something' })) {
 *     if (event.type === 'done') break
 *   }
 */
export function createAgent(config: AgentConfig) {
  return {
    async *run(params: AgentRunParams): AsyncGenerator<AgentEvent> {
      yield* agentLoop(config, params)
    },
  }
}

async function* agentLoop(
  config: AgentConfig,
  params: AgentRunParams,
): AsyncGenerator<AgentEvent> {
  const {
    tools,
    permissions,
    memory,
    context,
    prompts,
    model,
    baseInstructions = DEFAULT_INSTRUCTIONS,
    maxIterations = parseInt(process.env['BASED_AGENT_MAX_ITERATIONS'] ?? '100', 10),
    maxTokens = parseInt(process.env['BASED_AGENT_MAX_TOKENS'] ?? '8192', 10),
  } = config

  const workingDirectory = config.workingDirectory ?? process.cwd()

  // Build the initial system prompt
  const systemPrompt = prompts.build({
    baseInstructions,
    toolDescriptions: tools.toPromptDescriptions(),
    memoryContext: memory.render(),
    runtimeContext: {
      date: new Date().toISOString().split('T')[0] ?? '',
      workingDirectory,
    },
  })

  // Initialize message history
  const messages: Message[] = [
    ...(params.messages ?? []),
    userMessage(params.task),
  ]

  // Track initial messages so token estimates are accurate from the start (H-2)
  for (const msg of messages) {
    context.track(msg)
  }

  let iteration = 0
  let nearLimitEmitted = false

  while (true) {
    // --- Safety checks ---
    if (iteration >= maxIterations) {
      yield { type: 'done', reason: 'max_iterations' as TerminationReason }
      return
    }

    if (params.signal?.aborted) {
      yield { type: 'done', reason: 'user_abort' as TerminationReason }
      return
    }

    // Check context budget
    if (context.needsCompaction()) {
      const before = context.getTokenCount()
      const compacted = await context.compact('sliding_window', messages)
      messages.splice(1, messages.length - 1, ...compacted) // preserve first user message
      const after = context.getTokenCount()
      nearLimitEmitted = false // reset after compaction
      yield { type: 'context_compacted', beforeTokens: before, afterTokens: after }
    } else if (!nearLimitEmitted && context.isNearLimit()) {
      nearLimitEmitted = true
      yield { type: 'context_near_limit', tokenCount: context.getTokenCount(), limit: context.getMaxTokens() }
    }

    iteration++
    yield { type: 'model_request_start', iteration }

    // --- Call the model ---
    let finalResponse = null

    try {
      for await (const event of model.chat({
        messages,
        systemPrompt,
        tools: tools.toDefinitions(),
        maxTokens,
        ...(params.signal !== undefined ? { signal: params.signal } : {}),
      })) {
        if (event.type === 'text_delta') {
          // Streaming text output — callers can display this in real time
          // We don't yield a separate event for each delta to keep the event
          // surface clean; the full response comes in message_complete
        } else if (event.type === 'message_complete') {
          finalResponse = event.response
          context.track({ role: 'assistant', content: event.response.content })
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      yield { type: 'error', error: err }
      yield { type: 'done', reason: 'error' as TerminationReason }
      return
    }

    if (!finalResponse) {
      yield { type: 'done', reason: 'error' as TerminationReason }
      return
    }

    yield { type: 'model_response', response: finalResponse }

    // --- Append assistant response to history ---
    messages.push({ role: 'assistant', content: finalResponse.content })

    // --- No tool calls → we're done ---
    if (!finalResponse.toolUses || finalResponse.toolUses.length === 0) {
      yield { type: 'done', reason: 'end_turn' as TerminationReason }
      return
    }

    // --- Execute tool calls ---
    const toolResults: ToolResultContent[] = []

    for (const toolUse of finalResponse.toolUses) {
      yield { type: 'tool_request', toolUse }

      // Look up the tool
      const tool = tools.get(toolUse.name)
      if (!tool) {
        const err = new UnknownToolError(toolUse.name)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: err.message,
          is_error: true,
        })
        continue
      }

      // Check permissions
      const permissionDecision = await permissions.check({
        tool: toolUse.name,
        input: toolUse.input,
        readOnly: tool.readOnly,
        destructive: tool.destructive ?? false,
        context: { iteration, messages },
      })

      if (permissionDecision.behavior === 'deny') {
        yield { type: 'permission_denied', toolName: toolUse.name, reason: permissionDecision.reason }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Permission denied: ${permissionDecision.reason}`,
          is_error: true,
        })
        continue
      }

      if (permissionDecision.behavior === 'ask') {
        // In v0.1, there is no interactive approval handler.
        // Treat 'ask' as 'deny' — fail-closed.
        // Full interactive approval flow is a v0.2 feature.
        yield {
          type: 'permission_denied',
          toolName: toolUse.name,
          reason: `Approval required: ${permissionDecision.reason}`,
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Permission denied: approval required but no interactive handler is configured. Reason: ${permissionDecision.reason}`,
          is_error: true,
        })
        continue
      }

      // Execute the tool
      try {
        const result = await tools.execute(toolUse.name, toolUse.input, {
          workingDirectory,
          ...(params.signal !== undefined ? { signal: params.signal } : {}),
        })
        const output = context.truncateResult(result.output, tool.maxResultSizeChars)

        yield {
          type: 'tool_result',
          toolUseId: toolUse.id,
          output,
          isError: false,
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: output,
          is_error: false,
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        yield {
          type: 'tool_result',
          toolUseId: toolUse.id,
          output: errMsg,
          isError: true,
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: errMsg,
          is_error: true,
        })
      }
    }

    // Feed tool results back into the message history
    const resultMessage = toolResultMessage(toolResults)
    messages.push(resultMessage)
    context.track(resultMessage)
  }
}
