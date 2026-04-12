/**
 * Tool registry — the single source of truth for all available tools.
 *
 * Responsibilities:
 * - Registration and lookup by name
 * - Input validation before execution
 * - Result size enforcement (delegating truncation to the caller)
 * - Generating tool definitions for the model API
 * - Generating prompt descriptions for the system prompt
 */

import { z } from 'zod'
import type { Tool, ToolInputSchema, ToolApiDefinition, ToolContext, ToolResult } from './types.js'

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>()

  /**
   * Register a tool. Throws if a tool with the same name already exists.
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool '${tool.name}' is already registered`)
    }
    this.tools.set(tool.name, tool)
  }

  /**
   * Remove a tool from the registry.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * Look up a tool by name. Returns undefined if not found.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  /**
   * Check whether a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /**
   * Return all registered tools.
   */
  list(): Tool[] {
    return Array.from(this.tools.values())
  }

  /**
   * Execute a tool by name with validated input.
   * Throws if the tool is not found or if input validation fails.
   */
  async execute(
    name: string,
    rawInput: unknown,
    context?: Partial<ToolContext>,
  ): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) throw new Error(`Unknown tool: '${name}'`)

    // Parse and validate input
    const parseResult = tool.inputSchema.safeParse(rawInput)
    if (!parseResult.success) {
      throw new Error(
        `Invalid input for tool '${name}': ${parseResult.error.message}`,
      )
    }

    const input = parseResult.data as z.infer<ToolInputSchema>

    // Optional per-tool validation
    if (tool.validateInput) {
      const validation = tool.validateInput(input)
      if (!validation.valid) {
        throw new Error(`Tool '${name}' rejected input: ${validation.reason}`)
      }
    }

    const toolContext: ToolContext = {
      workingDirectory: context?.workingDirectory ?? process.cwd(),
      ...(context?.signal !== undefined ? { signal: context.signal } : {}),
    }

    return tool.execute(input, toolContext)
  }

  /**
   * Generate tool definitions for the model API (OpenAI / Anthropic format).
   */
  toDefinitions(): ToolApiDefinition[] {
    return Array.from(this.tools.values()).map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
    }))
  }

  /**
   * Generate human-readable tool descriptions for the system prompt.
   */
  toPromptDescriptions(): string[] {
    return Array.from(this.tools.values()).map(tool => {
      const safety = [
        tool.readOnly ? 'read-only' : 'read-write',
        tool.destructive ? 'DESTRUCTIVE' : null,
        tool.concurrencySafe ? 'concurrency-safe' : null,
      ]
        .filter(Boolean)
        .join(', ')
      return `**${tool.name}** [${safety}]\n${tool.description}`
    })
  }
}

// ---------------------------------------------------------------------------
// Minimal Zod → JSON Schema converter
// ---------------------------------------------------------------------------

function zodToJsonSchema(schema: ToolInputSchema): ToolApiDefinition['inputSchema'] {
  // Extract the Zod shape if available (ZodObject)
  const shape = (schema as { shape?: Record<string, unknown> }).shape

  if (!shape) {
    return { type: 'object', properties: {} }
  }

  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const zField = fieldSchema as z.ZodTypeAny
    const isOptional =
      zField instanceof z.ZodOptional || zField instanceof z.ZodDefault

    if (!isOptional) required.push(key)

    properties[key] = zodFieldToJsonSchema(zField)
  }

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
  }
}

function zodFieldToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  if (schema instanceof z.ZodString) {
    return {
      type: 'string',
      ...(schema.description ? { description: schema.description } : {}),
    }
  }
  if (schema instanceof z.ZodNumber) return { type: 'number' }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' }
  if (schema instanceof z.ZodArray) {
    return {
      type: 'array',
      items: zodFieldToJsonSchema(schema.element),
    }
  }
  if (schema instanceof z.ZodOptional) {
    return zodFieldToJsonSchema(schema.unwrap())
  }
  if (schema instanceof z.ZodDefault) {
    return zodFieldToJsonSchema(schema.removeDefault())
  }
  if (schema instanceof z.ZodEnum) {
    return { type: 'string', enum: schema.options as string[] }
  }
  // Fallback
  return { type: 'string' }
}
