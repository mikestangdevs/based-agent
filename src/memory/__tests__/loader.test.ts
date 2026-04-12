/**
 * Memory loader tests — verifies file discovery and context rendering.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MemoryLoader } from '../index.js'

let TEST_DIR: string

beforeEach(async () => {
  TEST_DIR = join(tmpdir(), 'based-agent-memory-test-' + Date.now() + '-' + Math.random().toString(36).slice(2))
  await mkdir(TEST_DIR, { recursive: true })
})

afterEach(async () => {
  await rm(TEST_DIR, { recursive: true, force: true })
})

describe('MemoryLoader', () => {
  it('returns empty context when no memory files exist', async () => {
    const ctx = await MemoryLoader.load({ rootDir: TEST_DIR })
    expect(ctx.files).toHaveLength(0)
    expect(ctx.totalChars).toBe(0)
    expect(ctx.render()).toBe('')
  })

  it('loads AGENT_CONTEXT.md from root directory', async () => {
    await writeFile(join(TEST_DIR, 'AGENT_CONTEXT.md'), '# Project Context\n\nTest content.')

    const ctx = await MemoryLoader.load({ rootDir: TEST_DIR })
    expect(ctx.files).toHaveLength(1)
    expect(ctx.files[0]?.layer).toBe('project')
    expect(ctx.files[0]?.content).toContain('Test content.')
  })

  it('loads nested context files from subdirectories', async () => {
    await writeFile(join(TEST_DIR, 'AGENT_CONTEXT.md'), '# Root')
    await mkdir(join(TEST_DIR, 'src'))
    await writeFile(join(TEST_DIR, 'src', 'AGENT_CONTEXT.md'), '# Src context')

    const ctx = await MemoryLoader.load({ rootDir: TEST_DIR, includeNested: true })
    expect(ctx.files.length).toBeGreaterThan(1)
  })

  it('uses task context at highest priority', async () => {
    await writeFile(join(TEST_DIR, 'AGENT_CONTEXT.md'), '# Project')

    const ctx = await MemoryLoader.load({
      rootDir: TEST_DIR,
      taskContext: 'Working on authentication module',
    })

    expect(ctx.files[0]?.layer).toBe('task')
    expect(ctx.files[0]?.content).toBe('Working on authentication module')
  })

  it('respects maxTotalChars budget', async () => {
    await writeFile(join(TEST_DIR, 'AGENT_CONTEXT.md'), 'A'.repeat(1000))

    const ctx = await MemoryLoader.load({ rootDir: TEST_DIR, maxTotalChars: 100 })
    expect(ctx.totalChars).toBeLessThanOrEqual(200) // Some slack for truncation message
  })

  it('renders a non-empty string when files are loaded', async () => {
    await writeFile(join(TEST_DIR, 'AGENT_CONTEXT.md'), '# Project Context\n\nImportant info.')

    const ctx = await MemoryLoader.load({ rootDir: TEST_DIR })
    const rendered = ctx.render()
    expect(rendered).toContain('## Loaded Memory Context')
    expect(rendered).toContain('Important info.')
  })

  it('discovers files without loading them', async () => {
    await writeFile(join(TEST_DIR, 'AGENT_CONTEXT.md'), '# Root')
    await mkdir(join(TEST_DIR, 'packages'))
    await writeFile(join(TEST_DIR, 'packages', 'AGENT_CONTEXT.md'), '# Packages')

    const paths = await MemoryLoader.discover(TEST_DIR)
    expect(paths.length).toBeGreaterThanOrEqual(1)
    expect(paths.some(p => p.endsWith('AGENT_CONTEXT.md'))).toBe(true)
  })
})
