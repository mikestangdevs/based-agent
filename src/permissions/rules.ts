/**
 * Built-in permission rules.
 *
 * Rules are evaluated in priority order (highest first).
 * The first matching rule wins.
 *
 * Three-tier risk model:
 *   low    — local, reversible, narrow scope        → allow
 *   medium — shared code paths, recoverable         → ask + rollback guidance
 *   high   — production impact, broad/irreversible  → ask with strong warning
 *
 * All rules can be removed or overridden by name:
 *   policy.removeRule('block-force-push')
 */

import type { PermissionRule } from './types.js'

// ---------------------------------------------------------------------------
// Low-risk: allow immediately
// ---------------------------------------------------------------------------

/**
 * Read-only tools are always safe. This runs before all other rules.
 */
export const ALLOW_READ_ONLY: PermissionRule = {
  name: 'allow-read-only',
  priority: 100,
  behavior: 'allow',
  reason: 'Read-only operation — safe to proceed',
  riskTier: 'low',
  match: (req) => req.readOnly,
}

// ---------------------------------------------------------------------------
// High-risk: irreversible or production-impacting operations
// These are checked BEFORE the generic destructive fallback.
// ---------------------------------------------------------------------------

/**
 * Force-pushing rewrites shared git history. Irreversible for collaborators.
 */
export const BLOCK_FORCE_PUSH: PermissionRule = {
  name: 'block-force-push',
  priority: 90,
  behavior: 'ask',
  reason: 'Force-pushing rewrites shared git history and cannot be undone by collaborators',
  riskTier: 'high',
  rollbackGuidance: 'Coordinate with teammates before force-pushing. Consider a revert commit instead.',
  match: (req) => {
    if (req.tool !== 'shell_exec') return false
    const cmd = extractCommand(req.input)
    return /git\s+push.+--force|git\s+push.+-f\b/.test(cmd)
  },
}

/**
 * Recursive deletes can wipe entire directory trees instantly.
 */
export const BLOCK_RECURSIVE_DELETE: PermissionRule = {
  name: 'block-recursive-delete',
  priority: 90,
  behavior: 'ask',
  reason: 'Recursive delete (rm -rf) permanently removes files with no recovery path',
  riskTier: 'high',
  rollbackGuidance: 'Ensure the target is in a git-tracked directory, or back up first.',
  match: (req) => {
    if (req.tool !== 'shell_exec') return false
    const cmd = extractCommand(req.input)
    return /rm\s+(-\w*r\w*f\w*|-rf|-fr|--recursive)\s/.test(cmd)
  },
}

/**
 * Destructive database operations — drops, truncates, irreversible migrations.
 */
export const BLOCK_DESTRUCTIVE_DB: PermissionRule = {
  name: 'block-destructive-db',
  priority: 90,
  behavior: 'ask',
  reason: 'Destructive database operation detected (DROP, TRUNCATE, or irreversible migration)',
  riskTier: 'high',
  rollbackGuidance: 'Take a database snapshot before proceeding. Test on a staging environment first.',
  match: (req) => {
    if (req.tool !== 'shell_exec') return false
    const cmd = extractCommand(req.input).toUpperCase()
    return /\b(DROP\s+TABLE|DROP\s+DATABASE|TRUNCATE\s+TABLE)\b/.test(cmd)
  },
}

/**
 * Writing to .env or secrets files risks leaking credentials.
 */
export const PROTECT_ENV_FILES: PermissionRule = {
  name: 'protect-env-files',
  priority: 90,
  behavior: 'ask',
  reason: 'Writing to .env or secrets files risks accidentally committing credentials',
  riskTier: 'high',
  rollbackGuidance: 'Ensure .env is in .gitignore. Consider using a secrets manager instead.',
  match: (req) => {
    if (req.tool !== 'file_write') return false
    const path = extractPath(req.input)
    return /\.env(\.\w+)?$|secrets?\.(json|yaml|yml|toml)$/i.test(path)
  },
}

// ---------------------------------------------------------------------------
// Medium-risk: shared code paths or recoverable-with-effort operations
// ---------------------------------------------------------------------------

/**
 * Writing to shared configuration files that affect many consumers.
 */
export const CAUTION_CONFIG_WRITES: PermissionRule = {
  name: 'caution-config-writes',
  priority: 50,
  behavior: 'ask',
  reason: 'Modifying shared configuration affects all consumers of this project',
  riskTier: 'medium',
  rollbackGuidance: 'Git-tracked change — revert with: git checkout <file>',
  match: (req) => {
    if (req.tool !== 'file_write') return false
    const path = extractPath(req.input)
    return /\/(package\.json|tsconfig\.json|\.eslintrc|vite\.config|webpack\.config|next\.config|docker-compose\.yml|Dockerfile)$/i.test(path)
  },
}

// ---------------------------------------------------------------------------
// Generic fallback: any remaining destructive tool
// ---------------------------------------------------------------------------

/**
 * Fallback for destructive tools not caught by a more specific rule above.
 * Kept for backwards compatibility — covers file_write and shell_exec generally.
 */
export const ASK_FOR_DESTRUCTIVE: PermissionRule = {
  name: 'ask-for-destructive',
  priority: 5,
  behavior: 'ask',
  reason: 'This operation is destructive — please confirm before proceeding',
  riskTier: 'medium',
  rollbackGuidance: 'Ensure the affected files are tracked in version control.',
  match: (req) => req.destructive,
}

// ---------------------------------------------------------------------------
// Default rule set
// ---------------------------------------------------------------------------

/** All built-in rules, in the order they are installed by PermissionPolicy. */
export const DEFAULT_RULES: PermissionRule[] = [
  ALLOW_READ_ONLY,
  BLOCK_FORCE_PUSH,
  BLOCK_RECURSIVE_DELETE,
  BLOCK_DESTRUCTIVE_DB,
  PROTECT_ENV_FILES,
  CAUTION_CONFIG_WRITES,
  ASK_FOR_DESTRUCTIVE,
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractCommand(input: unknown): string {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object') {
    const i = input as Record<string, unknown>
    return String(i['command'] ?? i['cmd'] ?? '')
  }
  return ''
}

function extractPath(input: unknown): string {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object') {
    const i = input as Record<string, unknown>
    return String(i['path'] ?? i['file'] ?? i['filePath'] ?? '')
  }
  return ''
}

