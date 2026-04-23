/**
 * ApprovalHandler — interactive human-in-the-loop approval for `ask`-tier tools.
 *
 * When the permission policy returns `ask`, the loop calls the registered
 * ApprovalHandler before deciding whether to allow or deny the tool call.
 * If no handler is registered, the loop falls back to fail-closed deny.
 *
 * Built-in implementations:
 *   CliApprovalHandler   — Interactive y/N prompt in the terminal
 *   AutoApproveHandler   — Always approves (for CI, tests, trusted contexts)
 *   AutoDenyHandler      — Always denies (explicit fail-closed, same as no handler)
 *
 * Custom implementations:
 *   Implement ApprovalHandler to route to Slack, a web UI, a queue, etc.
 *
 * Example:
 *   const agent = createAgent({
 *     ...config,
 *     approvalHandler: new CliApprovalHandler(),
 *   })
 */

import * as readline from 'node:readline/promises'
import type { PermissionRequest } from './types.js'

export type ApprovalOutcome = 'allow' | 'deny'

/**
 * Implement this to handle `ask`-tier permission requests.
 */
export interface ApprovalHandler {
  /**
   * Called when a tool requires approval before execution.
   * Return 'allow' to proceed, 'deny' to block the call.
   */
  approve(request: PermissionRequest, reason: string): Promise<ApprovalOutcome>
}

// ---------------------------------------------------------------------------
// Built-in implementations
// ---------------------------------------------------------------------------

/**
 * Interactive CLI prompt — prints tool details and waits for y/N input.
 * Suitable for local development and interactive templates.
 */
export class CliApprovalHandler implements ApprovalHandler {
  async approve(request: PermissionRequest, reason: string): Promise<ApprovalOutcome> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

    console.log()
    console.log('┌─ Approval Required ────────────────────────────')
    console.log(`│  Tool:   ${request.tool}`)
    console.log(`│  Reason: ${reason}`)
    if (request.input && typeof request.input === 'object') {
      const preview = JSON.stringify(request.input).slice(0, 120)
      console.log(`│  Input:  ${preview}`)
    }
    console.log('└────────────────────────────────────────────────')

    const answer = await rl.question('  Allow? [y/N] ')
    rl.close()
    console.log()

    return answer.trim().toLowerCase() === 'y' ? 'allow' : 'deny'
  }
}

/**
 * Always approves — use in CI pipelines and tests where all tools are pre-trusted.
 * Do NOT use in interactive workflows with untrusted tasks.
 */
export class AutoApproveHandler implements ApprovalHandler {
  async approve(_request: PermissionRequest, _reason: string): Promise<ApprovalOutcome> {
    return 'allow'
  }
}

/**
 * Always denies — explicit fail-closed handler.
 * Equivalent to registering no handler, but makes the intent visible in config.
 */
export class AutoDenyHandler implements ApprovalHandler {
  async approve(_request: PermissionRequest, _reason: string): Promise<ApprovalOutcome> {
    return 'deny'
  }
}
