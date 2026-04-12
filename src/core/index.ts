/**
 * Core module — agent loop, model adapters, errors.
 */

// Types
export type {
  Message,
  MessageContent,
  TextContent,
  ToolUseContent,
  ToolResultContent,
  AssistantResponse,
  ToolUseBlock,
  TokenUsage,
  AgentEvent,
  AgentRunParams,
  TerminationReason,
  Role,
} from '../types.js'

// Constructors
export { userMessage, assistantMessage, toolResultMessage } from '../types.js'

// Errors
export {
  AgentError,
  ModelError,
  ContextLimitError,
  UnknownToolError,
  PermissionDeniedError,
  MaxIterationsError,
  NoModelKeyError,
} from './errors.js'

// Model adapters
export type { ModelAdapter, ModelChatParams, ModelChatEvent, ToolDefinition } from './model-adapter.js'
export { AnthropicAdapter, OpenAIAdapter, createModelAdapter } from './model-adapter.js'

// Loop
export type { AgentConfig } from './loop.js'
export { createAgent } from './loop.js'
