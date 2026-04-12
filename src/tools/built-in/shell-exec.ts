/**
 * shell_exec — Execute a shell command.
 * readOnly: false | destructive: true | concurrencySafe: false
 *
 * This is the most powerful and most dangerous tool. It is marked destructive
 * and will require explicit permission approval by default.
 *
 * Set a timeout to prevent runaway processes.
 */

import { z } from 'zod'
import { spawn } from 'node:child_process'
import type { Tool, ToolContext } from '../types.js'

const schema = z.object({
  command: z.string().describe('Shell command to execute'),
  timeout: z.number().int().positive().optional().describe('Timeout in milliseconds (default: 30000)'),
})

const DEFAULT_TIMEOUT = 30_000

export class ShellExecTool implements Tool<typeof schema> {
  readonly name = 'shell_exec'
  readonly description = `Execute a shell command and return the output. Stdout and stderr are combined. Commands time out after 30 seconds by default. REQUIRES PERMISSION — destructive operations cannot be undone.`
  readonly inputSchema = schema
  readonly readOnly = false
  readonly destructive = true  // Irreversible — file deletions, network calls, etc.
  readonly concurrencySafe = false
  readonly maxResultSizeChars = 50_000

  async execute(input: z.infer<typeof schema>, context: ToolContext) {
    const timeout = input.timeout ?? DEFAULT_TIMEOUT
    const cwd = context.workingDirectory

    // Check abort before spawning
    if (context.signal?.aborted) {
      return { output: '[Aborted: signal was already aborted before execution]' }
    }

    return new Promise<{ output: string }>((resolve) => {
      const chunks: Buffer[] = []
      let timedOut = false

      const child = spawn('sh', ['-c', input.command], {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk))
      child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk))

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
      }, timeout)

      // Respect abort signal — use { once: true } to prevent leaks
      const onAbort = () => { child.kill('SIGTERM') }
      context.signal?.addEventListener('abort', onAbort, { once: true })

      child.on('close', (code) => {
        clearTimeout(timer)
        context.signal?.removeEventListener('abort', onAbort)
        const output = Buffer.concat(chunks).toString('utf-8').trimEnd()

        if (timedOut) {
          resolve({ output: `[Command timed out after ${timeout}ms]\n${output}` })
        } else {
          resolve({
            output: `[Exit code: ${code ?? '?'}]\n${output || '(no output)'}`,
          })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        context.signal?.removeEventListener('abort', onAbort)
        resolve({ output: `[Error: ${err.message}]` })
      })
    })
  }
}
