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
import type { ApprovalHandler } from '../permissions/approval.js'
import type { MemoryContext } from '../memory/index.js'
import type { ContextManager } from '../context/index.js'
import type { PromptBuilder } from '../prompts/index.js'
import type { EventLogger } from '../telemetry/index.js'
import { createRunContext } from './run-context.js'
import { UnknownToolError } from './errors.js'
import { DEFAULT_SYSTEM_PROMPT } from '../prompts/defaults.js'

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

  /**
   * Handler for `ask`-tier permission decisions.
   * When a tool requires approval, this is called before execution.
   * If not set, `ask` falls back to fail-closed deny.
   *
   * Built-ins: CliApprovalHandler (interactive), AutoApproveHandler (CI/tests)
   */
  approvalHandler?: ApprovalHandler

  /**
   * Event logger — called for every AgentEvent before it is yielded.
   * Wire to ConsoleLogger, NdJsonLogger, or your observability stack.
   */
  logger?: EventLogger

  /**
   * Maximum cumulative token budget for this run (input + output tokens combined).
   * When exceeded, the loop yields `done: budget_exceeded` and halts.
   * Prevents runaway costs from misconfigured agents or adversarial prompts.
   */
  tokenBudget?: number
}

// Production-grade behavioral contract. Override via AgentConfig.baseInstructions.
const DEFAULT_INSTRUCTIONS = DEFAULT_SYSTEM_PROMPT

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
    approvalHandler,
    logger,
    tokenBudget,
  } = config

  const workingDirectory = config.workingDirectory ?? process.cwd()
  const runCtx = createRunContext(params.task)

  /** Emit an event — calls logger then yields to the caller */
  async function* emit(event: AgentEvent): AsyncGenerator<AgentEvent> {
    try {
      await logger?.onEvent(runCtx.runId, event)
    } catch {
      // Logger errors must never crash the agent run
    }
    yield event
  }

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
  let cumulativeTokens = 0
  // Circuit breaker: track consecutive failures per tool name
  const consecutiveFailures: Record<string, number> = {}
  const CIRCUIT_BREAKER_THRESHOLD = 3

  while (true) {
    // --- Safety checks ---
    if (iteration >= maxIterations) {
      yield* emit({ type: 'done', reason: 'max_iterations' as TerminationReason })
      return
    }

    if (params.signal?.aborted) {
      yield* emit({ type: 'done', reason: 'user_abort' as TerminationReason })
      return
    }

    // Token budget check
    if (tokenBudget !== undefined && cumulativeTokens >= tokenBudget) {
      yield* emit({ type: 'done', reason: 'budget_exceeded' as TerminationReason })
      return
    }

    // Check context budget
    if (context.needsCompaction()) {
      const before = context.getTokenCount()
      const compacted = await context.compact('sliding_window', messages)
      messages.splice(1, messages.length - 1, ...compacted)
      const after = context.getTokenCount()
      nearLimitEmitted = false
      yield* emit({ type: 'context_compacted', beforeTokens: before, afterTokens: after })
    } else if (!nearLimitEmitted && context.isNearLimit()) {
      nearLimitEmitted = true
      yield* emit({ type: 'context_near_limit', tokenCount: context.getTokenCount(), limit: context.getMaxTokens() })
    }

    iteration++
    yield* emit({ type: 'model_request_start', iteration })

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
          // Accumulate token spend for budget enforcement
          cumulativeTokens += event.response.usage.inputTokens + event.response.usage.outputTokens
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error))
      yield* emit({ type: 'error', error: err })
      yield* emit({ type: 'done', reason: 'error' as TerminationReason })
      return
    }

    if (!finalResponse) {
      yield* emit({ type: 'done', reason: 'error' as TerminationReason })
      return
    }

    yield* emit({ type: 'model_response', response: finalResponse })

    // --- Append assistant response to history ---
    messages.push({ role: 'assistant', content: finalResponse.content })

    // --- No tool calls → we're done ---
    if (!finalResponse.toolUses || finalResponse.toolUses.length === 0) {
      yield* emit({ type: 'done', reason: 'end_turn' as TerminationReason })
      return
    }

    // --- Execute tool calls ---
    const toolResults: ToolResultContent[] = []

    for (const toolUse of finalResponse.toolUses) {
      yield* emit({ type: 'tool_request', toolUse })

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
        yield* emit({
          type: 'permission_denied' as const,
          toolName: toolUse.name,
          reason: permissionDecision.reason,
          ...(permissionDecision.riskTier !== undefined ? { riskTier: permissionDecision.riskTier } : {}),
          ...(permissionDecision.rollbackGuidance !== undefined ? { rollbackGuidance: permissionDecision.rollbackGuidance } : {}),
        })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: `Permission denied: ${permissionDecision.reason}`,
          is_error: true,
        })
        continue
      }

      if (permissionDecision.behavior === 'ask') {
        // Route to ApprovalHandler if registered; otherwise fail-closed.
        const outcome = approvalHandler
          ? await approvalHandler.approve(
              { tool: toolUse.name, input: toolUse.input, readOnly: tool.readOnly, destructive: tool.destructive ?? false, context: { iteration, messages } },
              permissionDecision.reason,
            )
          : 'deny'

        if (outcome === 'deny') {
          yield* emit({
            type: 'permission_denied' as const,
            toolName: toolUse.name,
            reason: approvalHandler
              ? `Approval denied by handler: ${permissionDecision.reason}`
              : `Approval required but no handler registered: ${permissionDecision.reason}`,
            ...(permissionDecision.riskTier !== undefined ? { riskTier: permissionDecision.riskTier } : {}),
            ...(permissionDecision.rollbackGuidance !== undefined ? { rollbackGuidance: permissionDecision.rollbackGuidance } : {}),
          })
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: `Permission denied: ${permissionDecision.reason}`,
            is_error: true,
          })
          continue
        }
        // outcome === 'allow' — fall through to execution below
      }

      // Execute the tool
      try {
        const result = await tools.execute(toolUse.name, toolUse.input, {
          workingDirectory,
          ...(params.signal !== undefined ? { signal: params.signal } : {}),
        })
        const output = context.truncateResult(result.output, tool.maxResultSizeChars)

        // Success — reset circuit breaker for this tool
        consecutiveFailures[toolUse.name] = 0

        yield* emit({
          type: 'tool_result',
          toolUseId: toolUse.id,
          output,
          isError: false,
        })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: output,
          is_error: false,
        })
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)

        // Circuit breaker — count consecutive failures for this tool
        consecutiveFailures[toolUse.name] = (consecutiveFailures[toolUse.name] ?? 0) + 1
        const failures = consecutiveFailures[toolUse.name]!

        yield* emit({
          type: 'tool_result',
          toolUseId: toolUse.id,
          output: errMsg,
          isError: true,
        })
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: errMsg,
          is_error: true,
        })

        if (failures >= CIRCUIT_BREAKER_THRESHOLD) {
          yield* emit({ type: 'done', reason: 'repeated_tool_failure' as TerminationReason })
          return
        }
      }
    }

    // Feed tool results back into the message history
    const resultMessage = toolResultMessage(toolResults)
    messages.push(resultMessage)
    context.track(resultMessage)
  }
}
