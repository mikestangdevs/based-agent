/**
 * Error types for the Based Agent core.
 *
 * Typed errors let the loop reason about what went wrong and
 * decide whether to retry, abort, or degrade gracefully.
 */

export class AgentError extends Error {
  readonly code: string
  readonly recoverable: boolean
  readonly originalCause: Error | undefined

  constructor(
    message: string,
    code: string,
    recoverable: boolean,
    cause?: Error,
  ) {
    super(message)
    this.name = 'AgentError'
    this.code = code
    this.recoverable = recoverable
    this.originalCause = cause
    // Maintain proper prototype chain
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

/** The model returned an error response */
export class ModelError extends AgentError {
  constructor(message: string, cause?: Error) {
    super(message, 'MODEL_ERROR', true, cause)
    this.name = 'ModelError'
  }
}

/** Context window is too large to proceed */
export class ContextLimitError extends AgentError {
  constructor(public readonly tokenCount: number, public readonly limit: number) {
    super(
      `Context limit exceeded: ${tokenCount} tokens (limit: ${limit})`,
      'CONTEXT_LIMIT',
      false,
    )
    this.name = 'ContextLimitError'
  }
}

/** A tool was called but does not exist in the registry */
export class UnknownToolError extends AgentError {
  constructor(public readonly toolName: string) {
    super(`Unknown tool: ${toolName}`, 'UNKNOWN_TOOL', false)
    this.name = 'UnknownToolError'
  }
}

/** A tool call was denied by the permission layer */
export class PermissionDeniedError extends AgentError {
  constructor(
    public readonly toolName: string,
    public readonly reason: string,
  ) {
    super(`Permission denied for tool '${toolName}': ${reason}`, 'PERMISSION_DENIED', false)
    this.name = 'PermissionDeniedError'
  }
}

/** The agent hit the max iteration limit */
export class MaxIterationsError extends AgentError {
  constructor(public readonly iterations: number) {
    super(
      `Agent exceeded maximum iterations (${iterations})`,
      'MAX_ITERATIONS',
      false,
    )
    this.name = 'MaxIterationsError'
  }
}

/** No valid model API key was found in the environment */
export class NoModelKeyError extends AgentError {
  constructor() {
    super(
      'No model API key found. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your environment.',
      'NO_MODEL_KEY',
      false,
    )
    this.name = 'NoModelKeyError'
  }
}
