/**
 * Tool registry and contract tests.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ToolRegistry, FileReadTool, GrepTool } from '../index.js'
import type { Tool } from '../index.js'

function makeTool(overrides?: Partial<Tool>): Tool {
  return {
    name: 'test_tool',
    description: 'A test tool',
    inputSchema: z.object({ value: z.string() }),
    readOnly: true,
    destructive: false,
    concurrencySafe: true,
    maxResultSizeChars: 10_000,
    async execute(input) {
      return { output: `got: ${(input as { value: string }).value}` }
    },
    ...overrides,
  }
}

describe('ToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = new ToolRegistry()
    const tool = makeTool()
    registry.register(tool)
    expect(registry.get('test_tool')).toBe(tool)
  })

  it('throws when registering a duplicate tool name', () => {
    const registry = new ToolRegistry()
    registry.register(makeTool())
    expect(() => registry.register(makeTool())).toThrow(/already registered/)
  })

  it('unregisters a tool', () => {
    const registry = new ToolRegistry()
    registry.register(makeTool())
    expect(registry.unregister('test_tool')).toBe(true)
    expect(registry.get('test_tool')).toBeUndefined()
  })

  it('executes a tool with valid input', async () => {
    const registry = new ToolRegistry()
    registry.register(makeTool())
    const result = await registry.execute('test_tool', { value: 'hello' })
    expect(result.output).toBe('got: hello')
  })

  it('throws on invalid input', async () => {
    const registry = new ToolRegistry()
    registry.register(makeTool())
    await expect(registry.execute('test_tool', { value: 123 })).rejects.toThrow()
  })

  it('throws on unknown tool', async () => {
    const registry = new ToolRegistry()
    await expect(registry.execute('ghost_tool', {})).rejects.toThrow(/Unknown tool/)
  })

  it('generates API definitions for all tools', () => {
    const registry = new ToolRegistry()
    registry.register(makeTool())
    const defs = registry.toDefinitions()
    expect(defs).toHaveLength(1)
    expect(defs[0]?.name).toBe('test_tool')
    expect(defs[0]?.inputSchema.type).toBe('object')
  })

  it('generates prompt descriptions', () => {
    const registry = new ToolRegistry()
    registry.register(makeTool())
    const descs = registry.toPromptDescriptions()
    expect(descs[0]).toContain('test_tool')
    expect(descs[0]).toContain('read-only')
  })

  it('FileReadTool has correct safety metadata', () => {
    const tool = new FileReadTool()
    expect(tool.readOnly).toBe(true)
    expect(tool.destructive).toBe(false)
    expect(tool.concurrencySafe).toBe(true)
    expect(tool.maxResultSizeChars).toBeGreaterThan(0)
  })

  it('GrepTool has correct safety metadata', () => {
    const tool = new GrepTool()
    expect(tool.readOnly).toBe(true)
    expect(tool.destructive).toBe(false)
  })
})
