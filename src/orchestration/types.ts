/**
 * Subagent types — the contract for task delegation and context boundaries.
 */

import type { Message } from '../types.js'
import type { Tool } from '../tools/index.js'
import type { PermissionPolicy } from '../permissions/index.js'

// ---------------------------------------------------------------------------
// Context inheritance modes
// ---------------------------------------------------------------------------

export type ContextInheritance =
  /** Fork from parent's full message history */
  | 'full'
  /** Compress parent history into a summary, start from there */
  | 'summary'
  /** Start completely fresh with just the task */
  | 'none'

// ---------------------------------------------------------------------------
// Subagent spawn params
// ---------------------------------------------------------------------------

export type SubagentParams = {
  /** What the subagent should do */
  task: string

  /** Subset of tools available to the subagent */
  tools?: Tool[]

  /** Permission policy for the subagent — can be more restrictive than the parent */
  permissions?: PermissionPolicy

  /** How much context to inherit from the parent */
  inheritContext: ContextInheritance

  /** Messages to seed the subagent with (used when inheritContext !== 'none') */
  parentMessages?: Message[]

  /** Maximum number of loop iterations for this subagent */
  maxIterations?: number

  /** Timeout in milliseconds */
  timeout?: number
}

// ---------------------------------------------------------------------------
// Subagent handle
// ---------------------------------------------------------------------------

export type SubagentStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timed_out'

export type SubagentResult = {
  output: string
  messages: Message[]
  toolsUsed: string[]
  iterationCount: number
  status: 'completed' | 'failed' | 'timed_out'
}

export interface SubagentHandle {
  /** Unique ID for this subagent */
  readonly id: string

  /** The task this subagent is working on */
  readonly task: string

  /** Current status */
  readonly status: SubagentStatus

  /** Result — available when status is 'completed' or 'failed' */
  readonly result: SubagentResult | undefined

  /** Wait for the subagent to finish */
  wait(): Promise<SubagentResult>

  /** Cancel the subagent */
  cancel(): Promise<void>
}
