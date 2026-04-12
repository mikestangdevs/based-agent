/**
 * Tool types — the contract between tools and the rest of the system.
 *
 * Every tool must implement this interface. The safety metadata fields
 * (readOnly, destructive, concurrencySafe, maxResultSizeChars) are not
 * optional. The permission layer and context manager depend on them.
 */

import type { ZodTypeAny, z } from 'zod'

// ---------------------------------------------------------------------------
// Tool context — passed to every tool execution
// ---------------------------------------------------------------------------

export type ToolContext = {
  /** Working directory for the current agent session */
  workingDirectory: string

  /** Signal to abort long-running tools */
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Tool result
// ---------------------------------------------------------------------------

export type ToolResult = {
  /** The primary output of the tool — what gets injected into context */
  output: string

  /** Optional structured data — not injected into context by default */
  data?: unknown
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export type ValidationResult =
  | { valid: true }
  | { valid: false; reason: string }

// ---------------------------------------------------------------------------
// Tool interface
// ---------------------------------------------------------------------------

export type ToolInputSchema = ZodTypeAny & { _output: Record<string, unknown> }

/**
 * The full tool interface. Every tool is an instance of this type.
 * Use the `defineTool` helper to build one without boilerplate.
 */
export interface Tool<TSchema extends ToolInputSchema = ToolInputSchema> {
  /** Unique name — used for routing from the model's tool_use blocks */
  readonly name: string

  /** One-paragraph description — shapes how the model uses this tool */
  readonly description: string

  /** Zod schema for input validation */
  readonly inputSchema: TSchema

  // --- Safety metadata ---

  /** True if this tool never modifies state */
  readonly readOnly: boolean

  /** True if this tool performs irreversible operations */
  readonly destructive: boolean

  /** True if this tool can be run concurrently with other tools */
  readonly concurrencySafe: boolean

  /** Maximum output size in characters before truncation */
  readonly maxResultSizeChars: number

  // --- Execution ---

  /** Validate the input before execution (optional) */
  validateInput?(input: z.infer<TSchema>): ValidationResult

  /** Execute the tool and return a result */
  execute(input: z.infer<TSchema>, context: ToolContext): Promise<ToolResult>

  /** Format the result for display (optional — defaults to raw output) */
  formatResult?(output: string): string
}

// ---------------------------------------------------------------------------
// defineTool — factory helper for building tools without class boilerplate
// ---------------------------------------------------------------------------

/**
 * Build a tool without writing a class.
 *
 * ```typescript
 * const myTool = defineTool({
 *   name: 'ping',
 *   description: 'Ping a host',
 *   inputSchema: z.object({ host: z.string() }),
 *   readOnly: true, destructive: false, concurrencySafe: true, maxResultSizeChars: 1_000,
 *   async execute(input) {
 *     return { output: `Pinging ${input.host}` }
 *   },
 * })
 * ```
 */
export function defineTool<TSchema extends ToolInputSchema>(definition: Tool<TSchema>): Tool<TSchema> {
  return definition
}

// ---------------------------------------------------------------------------
// Tool definition for the model (what gets sent in API requests)
// ---------------------------------------------------------------------------

export type ToolApiDefinition = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}
