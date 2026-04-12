/**
 * Prompt builder — layered system prompt composition.
 *
 * The system prompt is not assembled by string concatenation.
 * It is composed from named, ordered layers with defined budgets.
 * This makes the prompt maintainable, testable, and cache-stable.
 *
 * Composition order (top → bottom):
 *   1. Base instructions  (identity, tone, rules — never changes)
 *   2. Tool descriptions  (auto-generated — changes with tool set)
 *   3. Memory context     (loaded from disk — changes with memory files)
 *   4. Runtime context    (date, git, env — changes once per session)
 *   5. Task context       (what the user asked for — changes per task)
 *   6. Constraints        (safety rails, output format — configurable)
 */

export type PromptBuildParams = {
  /** Identity, capabilities, and behavioral rules. Put nothing dynamic here. */
  baseInstructions: string

  /**
   * Tool descriptions. Generate from ToolRegistry.toPromptDescriptions().
   * Don't write these by hand.
   */
  toolDescriptions?: string[]

  /**
   * Memory context string. Generate from MemoryContext.render().
   * May be empty if no memory files were found.
   */
  memoryContext?: string

  /**
   * Runtime context values. Injected once per session.
   * Values are formatted as a key-value list.
   */
  runtimeContext?: Record<string, string>

  /**
   * The current task or goal. Most volatile layer — changes per user request.
   */
  taskContext?: string

  /**
   * Explicit behavioral constraints. Appended after task context.
   * Good for safety rails or output format instructions.
   */
  constraints?: string[]
}

export class PromptBuilder {
  /**
   * Build a system prompt by composing all layers in order.
   * Empty or undefined layers are omitted cleanly.
   */
  build(params: PromptBuildParams): string {
    const sections: string[] = []

    // 1. Base instructions — always present
    sections.push(params.baseInstructions.trim())

    // 2. Tool descriptions — from tool registry
    if (params.toolDescriptions && params.toolDescriptions.length > 0) {
      sections.push([
        '## Available Tools',
        '',
        params.toolDescriptions.join('\n\n'),
      ].join('\n'))
    }

    // 3. Memory context — from AGENT_CONTEXT.md and other memory files
    if (params.memoryContext?.trim()) {
      sections.push(params.memoryContext.trim())
    }

    // 4. Runtime context — date, environment, git status
    if (params.runtimeContext && Object.keys(params.runtimeContext).length > 0) {
      const kvLines = Object.entries(params.runtimeContext)
        .filter(([, v]) => v?.trim())
        .map(([k, v]) => `- **${k}**: ${v}`)

      if (kvLines.length > 0) {
        sections.push([
          '## Runtime Context',
          '',
          kvLines.join('\n'),
        ].join('\n'))
      }
    }

    // 5. Task context — what the user asked for
    if (params.taskContext?.trim()) {
      sections.push([
        '## Current Task',
        '',
        params.taskContext.trim(),
      ].join('\n'))
    }

    // 6. Constraints — safety rails and output format
    if (params.constraints && params.constraints.length > 0) {
      sections.push([
        '## Constraints',
        '',
        params.constraints.map(c => `- ${c}`).join('\n'),
      ].join('\n'))
    }

    return sections.join('\n\n---\n\n')
  }
}
