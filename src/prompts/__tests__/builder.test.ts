/**
 * PromptBuilder tests — verifies layered system prompt composition.
 */

import { describe, it, expect } from 'vitest'
import { PromptBuilder } from '../index.js'

describe('PromptBuilder', () => {
  it('builds a prompt from base instructions only', () => {
    const builder = new PromptBuilder()
    const result = builder.build({ baseInstructions: 'You are a test agent.' })
    expect(result).toContain('You are a test agent.')
  })

  it('includes tool descriptions section when provided', () => {
    const builder = new PromptBuilder()
    const result = builder.build({
      baseInstructions: 'Base.',
      toolDescriptions: ['file_read — reads a file', 'grep — searches files'],
    })
    expect(result).toContain('## Available Tools')
    expect(result).toContain('file_read')
    expect(result).toContain('grep')
  })

  it('omits tool descriptions section when toolDescriptions is empty', () => {
    const builder = new PromptBuilder()
    const result = builder.build({ baseInstructions: 'Base.', toolDescriptions: [] })
    expect(result).not.toContain('## Available Tools')
  })

  it('includes memory context when provided', () => {
    const builder = new PromptBuilder()
    const result = builder.build({
      baseInstructions: 'Base.',
      memoryContext: '## Loaded Memory Context\n\nSome project context here.',
    })
    expect(result).toContain('## Loaded Memory Context')
    expect(result).toContain('Some project context here.')
  })

  it('omits memory context when empty or whitespace-only', () => {
    const builder = new PromptBuilder()
    const result = builder.build({ baseInstructions: 'Base.', memoryContext: '   ' })
    expect(result).not.toContain('## Loaded Memory Context')
  })

  it('includes runtime context when provided', () => {
    const builder = new PromptBuilder()
    const result = builder.build({
      baseInstructions: 'Base.',
      runtimeContext: { date: '2026-04-12', workingDirectory: '/project' },
    })
    expect(result).toContain('## Runtime Context')
    expect(result).toContain('**date**')
    expect(result).toContain('2026-04-12')
    expect(result).toContain('/project')
  })

  it('omits runtime context entries that are empty strings', () => {
    const builder = new PromptBuilder()
    const result = builder.build({
      baseInstructions: 'Base.',
      runtimeContext: { date: '2026-04-12', workingDirectory: '' },
    })
    expect(result).toContain('**date**')
    expect(result).not.toContain('**workingDirectory**')
  })

  it('includes task context section when provided', () => {
    const builder = new PromptBuilder()
    const result = builder.build({
      baseInstructions: 'Base.',
      taskContext: 'Refactor the authentication module.',
    })
    expect(result).toContain('## Current Task')
    expect(result).toContain('Refactor the authentication module.')
  })

  it('includes constraints section when provided', () => {
    const builder = new PromptBuilder()
    const result = builder.build({
      baseInstructions: 'Base.',
      constraints: ['Do not delete files', 'Confirm before writing'],
    })
    expect(result).toContain('## Constraints')
    expect(result).toContain('Do not delete files')
    expect(result).toContain('Confirm before writing')
  })

  it('sections are separated by dividers', () => {
    const builder = new PromptBuilder()
    const result = builder.build({
      baseInstructions: 'Base.',
      taskContext: 'Task.',
    })
    expect(result).toContain('---')
  })

  it('builds a full prompt with all layers', () => {
    const builder = new PromptBuilder()
    const result = builder.build({
      baseInstructions: 'You are an agent.',
      toolDescriptions: ['tool_a — does A'],
      memoryContext: '## Loaded Memory Context\n\nContext here.',
      runtimeContext: { date: '2026-04-12' },
      taskContext: 'Do the thing.',
      constraints: ['Be careful'],
    })

    expect(result).toContain('You are an agent.')
    expect(result).toContain('## Available Tools')
    expect(result).toContain('## Loaded Memory Context')
    expect(result).toContain('## Runtime Context')
    expect(result).toContain('## Current Task')
    expect(result).toContain('## Constraints')
  })
})
