/**
 * file_write — Write content to a file.
 * readOnly: false | destructive: true | concurrencySafe: false
 *
 * Creates the file if it does not exist. Overwrites if it does.
 * The permission layer will prompt before executing this by default.
 */

import { z } from 'zod'
import { writeFile, mkdir, realpath } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import type { Tool, ToolContext } from '../types.js'

const schema = z.object({
  path: z.string().describe('Absolute or relative path to write to'),
  content: z.string().describe('Content to write to the file'),
  createDirectories: z.boolean().optional().describe('Create parent directories if they do not exist (default: true)'),
})

export class FileWriteTool implements Tool<typeof schema> {
  readonly name = 'file_write'
  readonly description = `Write content to a file. Creates the file and parent directories if they do not exist. Overwrites existing content. Requires permission for destructive overwrites.`
  readonly inputSchema = schema
  readonly readOnly = false
  readonly destructive = true   // Overwrites are irreversible without version control
  readonly concurrencySafe = false
  readonly maxResultSizeChars = 10_000

  async execute(input: z.infer<typeof schema>, context: ToolContext) {
    const fullPath = resolve(context.workingDirectory, input.path)

    // Path containment check — resolve symlinks on the root to prevent traversal
    // via symlinks. The target file may not exist yet, so only canonicalize the root.
    let canonicalRoot: string
    try {
      canonicalRoot = await realpath(context.workingDirectory)
    } catch {
      return { output: `Error: working directory cannot be resolved.` }
    }

    // Re-resolve fullPath relative to the canonical root
    const canonicalPath = resolve(canonicalRoot, input.path)
    if (!canonicalPath.startsWith(canonicalRoot)) {
      return { output: `Error: path '${input.path}' resolves outside the working directory. Access denied.` }
    }

    if (input.createDirectories !== false) {
      await mkdir(dirname(canonicalPath), { recursive: true })
    }

    await writeFile(canonicalPath, input.content, 'utf-8')

    const lineCount = input.content.split('\n').length
    return {
      output: `Wrote ${input.content.length} characters (${lineCount} lines) to ${input.path}`,
    }
  }
}
