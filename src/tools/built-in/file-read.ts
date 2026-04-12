/**
 * file_read — Read the contents of a file.
 * readOnly: true | destructive: false | concurrencySafe: true
 */

import { z } from 'zod'
import { readFile, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Tool, ToolContext } from '../types.js'

const schema = z.object({
  path: z.string().describe('Absolute or relative path to the file to read'),
  startLine: z.number().int().positive().optional().describe('First line to read (1-indexed, inclusive)'),
  endLine: z.number().int().positive().optional().describe('Last line to read (1-indexed, inclusive)'),
})

export class FileReadTool implements Tool<typeof schema> {
  readonly name = 'file_read'
  readonly description = `Read the contents of a file. Optionally specify startLine and endLine to read a range of lines (1-indexed). Returns the file contents as a string with line numbers prepended.`
  readonly inputSchema = schema
  readonly readOnly = true
  readonly destructive = false
  readonly concurrencySafe = true
  readonly maxResultSizeChars = 100_000

  async execute(input: z.infer<typeof schema>, context: ToolContext) {
    const fullPath = resolve(context.workingDirectory, input.path)

    // Path containment check — resolve symlinks before checking containment
    // to prevent traversal via symlinks pointing outside the working directory
    let canonicalPath: string
    let canonicalRoot: string
    try {
      canonicalRoot = await realpath(context.workingDirectory)
      canonicalPath = await realpath(fullPath)
    } catch {
      return { output: `Error: path '${input.path}' does not exist or cannot be resolved.` }
    }

    if (!canonicalPath.startsWith(canonicalRoot)) {
      return { output: `Error: path '${input.path}' resolves outside the working directory. Access denied.` }
    }

    const content = await readFile(fullPath, 'utf-8')
    const lines = content.split('\n')

    const start = input.startLine ? Math.max(0, input.startLine - 1) : 0
    const end = input.endLine ? Math.min(lines.length, input.endLine) : lines.length

    const selected = lines
      .slice(start, end)
      .map((line, i) => `${start + i + 1}: ${line}`)
      .join('\n')

    return { output: selected }
  }
}
