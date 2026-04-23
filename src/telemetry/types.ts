/**
 * Telemetry — structured event logging for agent runs.
 *
 * The EventLogger interface hooks into every AgentEvent before it's yielded
 * to the caller, giving you a single tap point for:
 *   - Structured log output (JSON, NDJSON)
 *   - OpenTelemetry span creation
 *   - Langfuse / LangSmith traces
 *   - Custom metrics emission (token cost, latency, tool error rates)
 *
 * Usage:
 *   const agent = createAgent({
 *     ...config,
 *     logger: new ConsoleLogger(),          // structured JSON to stdout
 *     // logger: new NdJsonLogger(stream),  // NDJSON to a file or queue
 *   })
 *
 * Custom implementation:
 *   class MyLogger implements EventLogger {
 *     onEvent(runId: string, event: AgentEvent) {
 *       myObservabilitySDK.track({ runId, ...event })
 *     }
 *   }
 */

import type { AgentEvent } from '../types.js'

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface EventLogger {
  /**
   * Called for every AgentEvent before it is yielded to the caller.
   * May be sync or async. Errors thrown here are swallowed — loggers
   * must not crash the agent run.
   */
  onEvent(runId: string, event: AgentEvent): void | Promise<void>
}

// ---------------------------------------------------------------------------
// Built-in implementations
// ---------------------------------------------------------------------------

/**
 * Logs every event as structured JSON to stderr.
 * Easy to pipe into log aggregators (Datadog, Splunk, CloudWatch).
 */
export class ConsoleLogger implements EventLogger {
  private readonly stream: 'stdout' | 'stderr'

  constructor(options?: { stream?: 'stdout' | 'stderr' }) {
    this.stream = options?.stream ?? 'stderr'
  }

  onEvent(runId: string, event: AgentEvent): void {
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      runId,
      event: event.type,
      ...this.summarize(event),
    })

    if (this.stream === 'stderr') {
      process.stderr.write(entry + '\n')
    } else {
      process.stdout.write(entry + '\n')
    }
  }

  private summarize(event: AgentEvent): Record<string, unknown> {
    switch (event.type) {
      case 'model_request_start':
        return { iteration: event.iteration }
      case 'model_response':
        return {
          stopReason: event.response.stopReason,
          inputTokens: event.response.usage.inputTokens,
          outputTokens: event.response.usage.outputTokens,
          ...(event.response.usage.cacheReadTokens ? { cacheReadTokens: event.response.usage.cacheReadTokens } : {}),
        }
      case 'tool_request':
        return { tool: event.toolUse.name, toolId: event.toolUse.id }
      case 'tool_result':
        return { toolId: event.toolUseId, isError: event.isError, outputLen: event.output.length }
      case 'permission_denied':
        return {
          tool: event.toolName,
          reason: event.reason,
          ...(event.riskTier ? { riskTier: event.riskTier } : {}),
        }
      case 'context_near_limit':
        return { tokenCount: event.tokenCount, limit: event.limit }
      case 'context_compacted':
        return { beforeTokens: event.beforeTokens, afterTokens: event.afterTokens }
      case 'error':
        return { message: event.error.message }
      case 'done':
        return { reason: event.reason }
      default:
        return {}
    }
  }
}

/**
 * Emits one JSON object per line to a writable stream.
 * Suitable for piping into queues (Redis, Kafka, S3) or log files.
 *
 * Example:
 *   const stream = fs.createWriteStream('run.ndjson', { flags: 'a' })
 *   const logger = new NdJsonLogger(stream)
 */
export class NdJsonLogger implements EventLogger {
  constructor(
    private readonly output: { write(chunk: string): void },
  ) {}

  onEvent(runId: string, event: AgentEvent): void {
    this.output.write(
      JSON.stringify({ ts: new Date().toISOString(), runId, ...event }) + '\n',
    )
  }
}
