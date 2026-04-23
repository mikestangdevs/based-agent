/**
 * Shared types for the Based Agent framework.
 *
 * Defines the communication contract used by all systems:
 * messages, events, model responses, tool blocks.
 *
 * Import from the root barrel ('based-agent') rather than this file directly.
 */
import type { RiskTier } from './permissions/types.js'

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export type Role = 'user' | 'assistant' | 'system'

export type TextContent = {
  type: 'text'
  text: string
}

export type ToolUseContent = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export type ToolResultContent = {
  type: 'tool_result'
  tool_use_id: string
  content: string
  is_error?: boolean
}

export type MessageContent = TextContent | ToolUseContent | ToolResultContent

export type Message = {
  role: Role
  content: MessageContent[]
}

// Shorthand constructors
export function userMessage(content: string): Message {
  return { role: 'user', content: [{ type: 'text', text: content }] }
}

export function assistantMessage(content: MessageContent[]): Message {
  return { role: 'assistant', content }
}

export function toolResultMessage(results: ToolResultContent[]): Message {
  return { role: 'user', content: results }
}

// ---------------------------------------------------------------------------
// Model response
// ---------------------------------------------------------------------------

export type AssistantResponse = {
  content: MessageContent[]
  toolUses: ToolUseBlock[]
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage: TokenUsage
}

export type ToolUseBlock = {
  id: string
  name: string
  input: unknown
}

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

// ---------------------------------------------------------------------------
// Agent events — yielded from the loop
// ---------------------------------------------------------------------------

export type AgentEvent =
  | { type: 'model_request_start'; iteration: number }
  | { type: 'model_response'; response: AssistantResponse }
  | { type: 'tool_request'; toolUse: ToolUseBlock }
  | { type: 'tool_result'; toolUseId: string; output: string; isError: boolean }
  | {
      type: 'permission_denied'
      toolName: string
      reason: string
      /** Risk tier of the blocked operation, if classified */
      riskTier?: RiskTier
      /** Rollback or recovery guidance for medium/high risk blocks */
      rollbackGuidance?: string
    }
  | { type: 'context_near_limit'; tokenCount: number; limit: number }
  | { type: 'context_compacted'; beforeTokens: number; afterTokens: number }
  | { type: 'error'; error: Error }
  | { type: 'done'; reason: TerminationReason }

export type TerminationReason =
  | 'end_turn'             // Model indicated it is done
  | 'max_iterations'       // Hit safety limit
  | 'budget_exhausted'     // Token budget exhausted (legacy alias)
  | 'budget_exceeded'      // Token budget exceeded
  | 'user_abort'           // AbortController fired
  | 'error'                // Unrecoverable error
  | 'repeated_tool_failure' // Same tool failed 3+ consecutive times (circuit breaker)

// ---------------------------------------------------------------------------
// Agent run params
// ---------------------------------------------------------------------------

export type AgentRunParams = {
  /** Initial task or message from the user */
  task: string

  /** Previous message history to resume from (optional) */
  messages?: Message[]

  /** AbortController to cancel the run */
  signal?: AbortSignal
}
