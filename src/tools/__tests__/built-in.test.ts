/**
 * Built-in tool tests — verifies path containment, safety metadata, and core behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { FileReadTool, FileWriteTool, GrepTool, ShellExecTool, WebSearchTool } from '../index.js'

let TEST_DIR: string

beforeEach(async () => {
  TEST_DIR = join(tmpdir(), 'based-agent-tools-test-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  await mkdir(TEST_DIR, { recursive: true })
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// FileReadTool
// ---------------------------------------------------------------------------

describe('FileReadTool', () => {
  it('has correct safety metadata', () => {
    const tool = new FileReadTool()
    expect(tool.readOnly).toBe(true)
    expect(tool.destructive).toBe(false)
    expect(tool.concurrencySafe).toBe(true)
    expect(tool.maxResultSizeChars).toBeGreaterThan(0)
  })

  it('reads a file within the working directory', async () => {
    const tool = new FileReadTool()
    const filePath = join(TEST_DIR, 'test.txt')
    await writeFile(filePath, 'Hello, world!')

    const result = await tool.execute(
      { path: 'test.txt' },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toContain('Hello, world!')
  })

  it('returns error output for path traversal attempt', async () => {
    const tool = new FileReadTool()
    const result = await tool.execute(
      { path: '../../../etc/passwd' },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toMatch(/outside|not allowed|traversal|does not exist|error/i)
  })

  it('returns error output for non-existent file', async () => {
    const tool = new FileReadTool()
    const result = await tool.execute(
      { path: 'nonexistent.txt' },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toMatch(/not found|ENOENT|error/i)
  })

  it('accepts an absolute path within working directory', async () => {
    const tool = new FileReadTool()
    const filePath = join(TEST_DIR, 'abs.txt')
    await writeFile(filePath, 'Absolute path content')

    const result = await tool.execute(
      { path: filePath },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toContain('Absolute path content')
  })
})

// ---------------------------------------------------------------------------
// FileWriteTool
// ---------------------------------------------------------------------------

describe('FileWriteTool', () => {
  it('has correct safety metadata', () => {
    const tool = new FileWriteTool()
    expect(tool.readOnly).toBe(false)
    expect(tool.destructive).toBe(true)
  })

  it('writes a file within the working directory', async () => {
    const tool = new FileWriteTool()
    await tool.execute(
      { path: 'output.txt', content: 'Written by agent' },
      { workingDirectory: TEST_DIR },
    )

    const reader = new FileReadTool()
    const readResult = await reader.execute({ path: 'output.txt' }, { workingDirectory: TEST_DIR })
    expect(readResult.output).toContain('Written by agent')
  })

  it('returns error output for path traversal attempt', async () => {
    const tool = new FileWriteTool()
    const result = await tool.execute(
      { path: '../../../tmp/evil.txt', content: 'evil' },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toMatch(/outside|not allowed|traversal/i)
  })

  it('creates nested directories when createDirs is true', async () => {
    const tool = new FileWriteTool()
    await tool.execute(
      { path: 'nested/deep/file.txt', content: 'nested', createDirectories: true },
      { workingDirectory: TEST_DIR },
    )

    const reader = new FileReadTool()
    const result = await reader.execute(
      { path: 'nested/deep/file.txt' },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toContain('nested')
  })
})

// ---------------------------------------------------------------------------
// GrepTool
// ---------------------------------------------------------------------------

describe('GrepTool', () => {
  it('has correct safety metadata', () => {
    const tool = new GrepTool()
    expect(tool.readOnly).toBe(true)
    expect(tool.destructive).toBe(false)
    expect(tool.concurrencySafe).toBe(true)
  })

  it('finds matching patterns in files', async () => {
    const tool = new GrepTool()
    await writeFile(join(TEST_DIR, 'search.txt'), 'line one\nfound it here\nline three')

    const result = await tool.execute(
      { pattern: 'found it', path: '.' },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toContain('found it')
  })

  it('returns no-match message when pattern not found', async () => {
    const tool = new GrepTool()
    await writeFile(join(TEST_DIR, 'search.txt'), 'nothing here')

    const result = await tool.execute(
      { pattern: 'xyz_not_found_xyz', path: '.' },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toContain('No matches')
  })
})

// ---------------------------------------------------------------------------
// ShellExecTool
// ---------------------------------------------------------------------------

describe('ShellExecTool', () => {
  it('has correct safety metadata', () => {
    const tool = new ShellExecTool()
    expect(tool.readOnly).toBe(false)
    expect(tool.destructive).toBe(true)
    expect(tool.concurrencySafe).toBe(false)
  })

  it('executes a simple command and returns output', async () => {
    const tool = new ShellExecTool()
    const result = await tool.execute(
      { command: 'echo "shell works"' },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toContain('shell works')
  })

  it('includes exit code in output', async () => {
    const tool = new ShellExecTool()
    const result = await tool.execute(
      { command: 'exit 0' },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toContain('[Exit code: 0]')
  })

  it('respects abort signal', async () => {
    const tool = new ShellExecTool()
    const controller = new AbortController()
    controller.abort()

    const result = await tool.execute(
      { command: 'echo "should not run"' },
      { workingDirectory: TEST_DIR, signal: controller.signal },
    )
    expect(result.output).toContain('[Aborted')
  })

  it('times out long-running commands', async () => {
    const tool = new ShellExecTool()
    const result = await tool.execute(
      { command: 'sleep 60', timeout: 100 },
      { workingDirectory: TEST_DIR },
    )
    expect(result.output).toContain('[Command timed out')
  }, 5000)
})

// ---------------------------------------------------------------------------
// WebSearchTool (stub mode)
// ---------------------------------------------------------------------------

describe('WebSearchTool', () => {
  it('has correct safety metadata', () => {
    const tool = new WebSearchTool()
    expect(tool.readOnly).toBe(true)
    expect(tool.destructive).toBe(false)
    expect(tool.concurrencySafe).toBe(true)
  })

  it('returns stub response when no provider configured', async () => {
    const tool = new WebSearchTool()
    const result = await tool.execute(
      { query: 'test query' },
      { workingDirectory: process.cwd() },
    )
    expect(result.output).toContain('not configured')
  })

  it('uses custom provider when provided', async () => {
    const mockProvider = {
      async search() {
        return [{ title: 'Mock Result', url: 'https://example.com', snippet: 'Mock snippet' }]
      },
    }
    const tool = new WebSearchTool(mockProvider)
    const result = await tool.execute(
      { query: 'test' },
      { workingDirectory: process.cwd() },
    )
    expect(result.output).toContain('Mock Result')
    expect(result.output).toContain('https://example.com')
  })
})
