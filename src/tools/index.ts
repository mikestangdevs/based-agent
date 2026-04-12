/**
 * Tools module — registry and built-in tools.
 */

export type { Tool, ToolContext, ToolResult, ValidationResult, ToolApiDefinition, ToolInputSchema } from './types.js'
export { defineTool } from './types.js'
export { ToolRegistry } from './registry.js'

// Built-in tools
export { FileReadTool } from './built-in/file-read.js'
export { FileWriteTool } from './built-in/file-write.js'
export { GrepTool } from './built-in/grep.js'
export { ShellExecTool } from './built-in/shell-exec.js'
export { WebSearchTool } from './built-in/web-search.js'
export type { WebSearchProvider, WebSearchResult } from './built-in/web-search.js'
