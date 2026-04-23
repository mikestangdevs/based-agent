/**
 * Run context — unique identity for each agent run.
 *
 * Every run gets a `runId` that propagates through all AgentEvents,
 * enabling log correlation, distributed tracing, and audit trails.
 *
 * Uses `crypto.randomUUID()` (Node 14.17+, no dependencies).
 */

export type RunContext = {
  /** Unique ID for this run — attach to all logs, spans, and events */
  readonly runId: string

  /** The original task that started this run */
  readonly task: string

  /** When the run started */
  readonly startedAt: Date
}

export function createRunContext(task: string): RunContext {
  return {
    runId: crypto.randomUUID(),
    task,
    startedAt: new Date(),
  }
}
