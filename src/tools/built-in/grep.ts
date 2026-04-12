/**
 * grep — Search for patterns in files.
 * readOnly: true | destructive: false | concurrencySafe: true
 */

import { z } from 'zod'
import { readFile, readdir, stat, realpath } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import type { Tool, ToolContext } from '../types.js'

const schema = z.object({
  pattern: z.string().describe('Regular expression pattern to search for'),
  path: z.string().optional().describe('File or directory to search in (default: current directory)'),
  filePattern: z.string().optional().describe('Glob-like file extension filter, e.g. ".ts" or ".md"'),
  contextLines: z.number().int().nonnegative().optional().describe('Number of context lines to show around each match (default: 0)'),
  maxResults: z.number().int().positive().optional().describe('Maximum number of results to return (default: 50)'),
  caseSensitive: z.boolean().optional().describe('Whether to match case-sensitively (default: true)'),
})

const MAX_FILE_SIZE = 500_000 // Skip files larger than 500KB

export class GrepTool implements Tool<typeof schema> {
  readonly name = 'grep'
  readonly description = `Search for a regex pattern in files. Returns matching lines with file paths and line numbers. Supports searching directories recursively. Use filePattern to filter by extension (e.g. ".ts").`
  readonly inputSchema = schema
  readonly readOnly = true
  readonly destructive = false
  readonly concurrencySafe = true
  readonly maxResultSizeChars = 50_000

  async execute(input: z.infer<typeof schema>, context: ToolContext) {
    const searchPath = resolve(context.workingDirectory, input.path ?? '.')

    // Path containment — prevent searching outside working directory
    let canonicalRoot: string
    let canonicalSearch: string
    try {
      canonicalRoot = await realpath(context.workingDirectory)
      canonicalSearch = await realpath(searchPath)
    } catch {
      return { output: `Error: path '${input.path ?? '.'}' does not exist or cannot be resolved.` }
    }
    if (!canonicalSearch.startsWith(canonicalRoot)) {
      return { output: `Error: path '${input.path}' resolves outside the working directory. Access denied.` }
    }

    const maxResults = input.maxResults ?? 50
    const contextLines = input.contextLines ?? 0
    const flags = input.caseSensitive === false ? 'gi' : 'g'
    let regex: RegExp
    try {
      regex = new RegExp(input.pattern, flags)
    } catch (err) {
      return { output: `Invalid regex pattern "${input.pattern}": ${err instanceof Error ? err.message : String(err)}` }
    }

    const results: string[] = []

    await this.searchPath(searchPath, regex, input.filePattern, contextLines, maxResults, context.workingDirectory, results, { count: 0, max: maxResults })

    if (results.length === 0) {
      return { output: `No matches found for pattern: ${input.pattern}` }
    }

    return { output: results.join('\n') }
  }

  private async searchPath(
    searchPath: string,
    regex: RegExp,
    filePattern: string | undefined,
    contextLines: number,
    maxResults: number,
    workingDir: string,
    results: string[],
    state: { count: number; max: number },
  ): Promise<void> {
    const stats = await stat(searchPath).catch(() => null)
    if (!stats) return

    if (stats.isDirectory()) {
      const entries = await readdir(searchPath).catch(() => [] as string[])
      for (const entry of entries) {
        if (entry.startsWith('.') || entry === 'node_modules') continue
        if (state.count >= state.max) break
        await this.searchPath(
          join(searchPath, entry),
          regex,
          filePattern,
          contextLines,
          maxResults,
          workingDir,
          results,
          state,
        )
      }
    } else if (stats.isFile()) {
      if (filePattern && !searchPath.endsWith(filePattern)) return
      if (stats.size > MAX_FILE_SIZE) return

      const content = await readFile(searchPath, 'utf-8').catch(() => null)
      if (!content) return

      const lines = content.split('\n')
      const relPath = relative(workingDir, searchPath)

      for (let i = 0; i < lines.length; i++) {
        if (state.count >= state.max) break
        const line = lines[i] ?? ''
        regex.lastIndex = 0
        if (regex.test(line)) {
          const start = Math.max(0, i - contextLines)
          const end = Math.min(lines.length - 1, i + contextLines)

          for (let j = start; j <= end; j++) {
            const prefix = j === i ? '>' : ' '
            results.push(`${relPath}:${j + 1}${prefix} ${lines[j]}`)
          }
          if (contextLines > 0) results.push('---')
          state.count++
        }
      }
    }
  }
}
