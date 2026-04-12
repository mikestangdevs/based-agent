/**
 * Permission policy types.
 *
 * The policy layer is the boundary between "the model wants to do X"
 * and "X actually happens." Every tool call is routed through it.
 */

// ---------------------------------------------------------------------------
// Core behavior
// ---------------------------------------------------------------------------

export type PermissionBehavior = 'allow' | 'deny' | 'ask'

export type PermissionRequest = {
  /** Name of the tool being called */
  tool: string

  /** Raw input to the tool */
  input: unknown

  /** Whether the tool is read-only */
  readOnly: boolean

  /** Whether the tool is destructive (irreversible) */
  destructive: boolean

  /** Ambient context for rule evaluation */
  context: PermissionContext
}

export type PermissionContext = {
  /** Current iteration number in the agent loop */
  iteration: number

  /** Current message history (for pattern-matching rules) */
  messages: unknown[]

  /** Arbitrary metadata from the calling context */
  meta?: Record<string, unknown>
}

export type PermissionDecision = {
  /** What to do */
  behavior: PermissionBehavior

  /** Human-readable reason — shown to the model on deny, to the user on ask */
  reason: string

  /** Which rule triggered this decision (for debugging) */
  ruleName?: string
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export type PermissionRule = {
  /** Unique name for debugging and logging */
  name: string

  /** Whether this rule matches the given request */
  match: (request: PermissionRequest) => boolean

  /** What behavior to apply if matched */
  behavior: PermissionBehavior

  /** Human-readable reason for this decision */
  reason: string

  /**
   * Priority — higher numbers are checked first.
   * Deny rules should have higher priority than allow rules.
   * Default: 0
   */
  priority?: number
}

// ---------------------------------------------------------------------------
// Policy options
// ---------------------------------------------------------------------------

export type PolicyOptions = {
  /**
   * What to do when running in non-interactive mode and a tool requires
   * manual approval. Default: 'deny'
   *
   * Use 'deny' for batch jobs and automation (safe default).
   * Use 'allow' only when you've pre-approved all risky tools via explicit rules.
   */
  nonInteractiveDefault?: PermissionBehavior

  /**
   * Whether we're in a non-interactive session (no user to prompt).
   * When true, 'ask' decisions fall back to nonInteractiveDefault.
   * Default: false
   */
  nonInteractive?: boolean
}
