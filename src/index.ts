/**
 * based-agent — public API
 *
 * Import everything you need from this single entry point.
 */

// Shared types
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
} from './types.js'
export { userMessage, assistantMessage, toolResultMessage } from './types.js'

// Core loop + model adapters
export type { AgentConfig, ModelAdapter, ModelChatParams, ModelChatEvent, ToolDefinition } from './core/index.js'
export { createAgent, createModelAdapter, AnthropicAdapter, OpenAIAdapter } from './core/index.js'
export { AgentError, ModelError, ContextLimitError, UnknownToolError, PermissionDeniedError, MaxIterationsError, NoModelKeyError } from './core/index.js'

// Tools
export type { Tool, ToolContext, ToolResult, ToolApiDefinition, ToolInputSchema, ValidationResult } from './tools/index.js'
export { ToolRegistry, defineTool, FileReadTool, FileWriteTool, GrepTool, ShellExecTool, WebSearchTool } from './tools/index.js'

// Permissions
export type { PermissionRule, PermissionRequest, PermissionDecision } from './permissions/index.js'
export { PermissionPolicy, ALLOW_READ_ONLY, ASK_FOR_DESTRUCTIVE } from './permissions/index.js'

// Memory
export type { MemoryContext, MemoryLayer, MemoryFile, MemoryLoadOptions } from './memory/index.js'
export { MemoryLoader } from './memory/index.js'

// Context
export type { ContextBudgetConfig, ContextManager, CompactionStrategy, SummarizationHook } from './context/index.js'
export { ContextWindowManager } from './context/index.js'

// Prompts
export type { PromptBuildParams } from './prompts/index.js'
export { PromptBuilder } from './prompts/index.js'

// Orchestration
export type { SubagentParams, SubagentHandle, SubagentResult, ContextInheritance } from './orchestration/index.js'
export { SubagentManager } from './orchestration/index.js'
