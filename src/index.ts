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
export type { RunContext } from './core/run-context.js'
export { createRunContext } from './core/run-context.js'

// Tools
export type { Tool, ToolContext, ToolResult, ToolApiDefinition, ToolInputSchema, ValidationResult } from './tools/index.js'
export { ToolRegistry, defineTool, FileReadTool, FileWriteTool, GrepTool, ShellExecTool, WebSearchTool } from './tools/index.js'

// Permissions
export type { PermissionRule, PermissionRequest, PermissionDecision, RiskTier, ApprovalHandler, ApprovalOutcome } from './permissions/index.js'
export { PermissionPolicy, ALLOW_READ_ONLY, ASK_FOR_DESTRUCTIVE, BLOCK_FORCE_PUSH, BLOCK_RECURSIVE_DELETE, BLOCK_DESTRUCTIVE_DB, PROTECT_ENV_FILES, CAUTION_CONFIG_WRITES, CliApprovalHandler, AutoApproveHandler, AutoDenyHandler } from './permissions/index.js'

// Telemetry
export type { EventLogger } from './telemetry/index.js'
export { ConsoleLogger, NdJsonLogger } from './telemetry/index.js'

// Memory
export type { MemoryContext, MemoryLayer, MemoryFile, MemoryLoadOptions } from './memory/index.js'
export { MemoryLoader, ConversationSummarizer } from './memory/index.js'

// Context
export type { ContextBudgetConfig, ContextManager, CompactionStrategy, SummarizationHook } from './context/index.js'
export { ContextWindowManager } from './context/index.js'

// Prompts
export type { PromptBuildParams } from './prompts/index.js'
export { PromptBuilder } from './prompts/index.js'

// Orchestration
export type { SubagentParams, SubagentHandle, SubagentResult, ContextInheritance } from './orchestration/index.js'
export { SubagentManager } from './orchestration/index.js'

// Specialized agent roles
export { codeExplorer, solutionArchitect, verificationSpecialist, generalPurpose, documentationGuide } from './orchestration/index.js'
