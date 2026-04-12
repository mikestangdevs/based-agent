/**
 * Memory loader — discovers and loads context files from disk.
 *
 * Layers (in injection order, highest priority first):
 *   task      — caller-provided inline context string
 *   project   — AGENT_CONTEXT.md at the root directory
 *   workspace — nested AGENT_CONTEXT.md files in subdirectories
 *   user      — ~/.based-agent/context.md
 *
 * Each layer is budget-trimmed before assembly.
 * The total output respects maxTotalChars.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import type { MemoryContext, MemoryFile, MemoryLayer, MemoryLoadOptions } from './types.js'

const DEFAULT_CONTEXT_FILENAME = 'AGENT_CONTEXT.md'
const DEFAULT_MAX_TOTAL_CHARS = 50_000

// Directories to skip when walking for nested context files
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', '.turbo'])

// ---------------------------------------------------------------------------
// MemoryContext implementation
// ---------------------------------------------------------------------------

class LoadedMemoryContext implements MemoryContext {
  constructor(
    public readonly files: MemoryFile[],
    public readonly totalChars: number,
  ) {}

  render(): string {
    if (this.files.length === 0) return ''

    const sections = this.files
      .filter(f => f.content.trim().length > 0)
      .map(f => {
        const layerLabel = f.layer.charAt(0).toUpperCase() + f.layer.slice(1)
        return `<!-- Memory: ${layerLabel} context (${f.path}) -->\n${f.content.trim()}`
      })

    if (sections.length === 0) return ''

    return [
      '## Loaded Memory Context',
      '',
      sections.join('\n\n---\n\n'),
    ].join('\n')
  }
}

// ---------------------------------------------------------------------------
// MemoryLoader
// ---------------------------------------------------------------------------

export class MemoryLoader {
  /**
   * Discover and load all memory files for the given options.
   * Returns a MemoryContext ready to inject into a system prompt.
   */
  static async load(options: MemoryLoadOptions): Promise<MemoryContext> {
    const {
      rootDir,
      contextFileName = DEFAULT_CONTEXT_FILENAME,
      includeNested = true,
      userContextPath,
      taskContext,
      maxTotalChars = DEFAULT_MAX_TOTAL_CHARS,
    } = options

    const allFiles: MemoryFile[] = []

    // Layer 1: task context (highest priority — inline, no file required)
    if (taskContext?.trim()) {
      allFiles.push({
        path: '<task>',
        content: taskContext,
        layer: 'task' as MemoryLayer,
        priority: 1000,
      })
    }

    // Layer 2: project-level AGENT_CONTEXT.md at root
    const projectFile = await tryReadFile(join(rootDir, contextFileName))
    if (projectFile !== null) {
      allFiles.push({
        path: join(rootDir, contextFileName),
        content: projectFile,
        layer: 'project' as MemoryLayer,
        priority: 100,
      })
    }

    // Layer 3: nested context files in subdirectories
    if (includeNested) {
      const nestedFiles = await discoverNestedFiles(rootDir, contextFileName)
      for (const file of nestedFiles) {
        // Don't double-load the root file
        if (file.path === join(rootDir, contextFileName)) continue
        allFiles.push({ ...file, layer: 'workspace' as MemoryLayer, priority: 50 })
      }
    }

    // Layer 4: user-level context
    const userPath = userContextPath ?? join(homedir(), '.based-agent', 'context.md')
    const userFile = await tryReadFile(resolve(userPath))
    if (userFile !== null) {
      allFiles.push({
        path: userPath,
        content: userFile,
        layer: 'user' as MemoryLayer,
        priority: 10,
      })
    }

    // Sort by priority, apply budget
    allFiles.sort((a, b) => b.priority - a.priority)
    const trimmedFiles = applyBudget(allFiles, maxTotalChars)
    const totalChars = trimmedFiles.reduce((sum, f) => sum + f.content.length, 0)

    return new LoadedMemoryContext(trimmedFiles, totalChars)
  }

  /**
   * Discover all context files in a directory tree, without loading them.
   */
  static async discover(rootDir: string, contextFileName = DEFAULT_CONTEXT_FILENAME): Promise<string[]> {
    const files = await discoverNestedFiles(rootDir, contextFileName)
    return files.map(f => f.path)
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function tryReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

async function discoverNestedFiles(
  dir: string,
  contextFileName: string,
  depth = 0,
): Promise<MemoryFile[]> {
  if (depth > 5) return [] // Safety: don't walk too deep

  const results: MemoryFile[] = []

  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return []
  }

  // Check for context file in this directory
  const contextPath = join(dir, contextFileName)
  const content = await tryReadFile(contextPath)
  if (content !== null) {
    results.push({ path: contextPath, content, layer: 'workspace', priority: 50 - depth })
  }

  // Recurse into subdirectories
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue

    const fullPath = join(dir, entry)
    const stats = await stat(fullPath).catch(() => null)
    if (stats?.isDirectory()) {
      const nested = await discoverNestedFiles(fullPath, contextFileName, depth + 1)
      results.push(...nested)
    }
  }

  return results
}

const TRUNCATION_SUFFIX = '\n\n[...truncated to fit memory budget]'

function applyBudget(files: MemoryFile[], maxTotalChars: number): MemoryFile[] {
  let remaining = maxTotalChars
  const result: MemoryFile[] = []

  for (const file of files) {
    if (remaining <= 0) break
    if (file.content.length <= remaining) {
      result.push(file)
      remaining -= file.content.length
    } else {
      // Slice to fit, leaving room for the truncation note
      const keepChars = Math.max(0, remaining - TRUNCATION_SUFFIX.length)
      result.push({ ...file, content: file.content.slice(0, keepChars) + TRUNCATION_SUFFIX })
      remaining = 0
    }
  }

  return result
}
