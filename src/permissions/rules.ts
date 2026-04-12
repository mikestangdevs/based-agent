/**
 * Built-in permission rules.
 *
 * These are installed as defaults by PermissionPolicy.
 * You can override or remove them with policy.removeRule(name).
 */

import type { PermissionRule } from './types.js'

/**
 * Read-only tools are always safe to allow.
 * This rule runs before the destructive check.
 */
export const ALLOW_READ_ONLY: PermissionRule = {
  name: 'allow-read-only',
  priority: 10,
  behavior: 'allow',
  reason: 'Read-only operations are safe',
  match: (req) => req.readOnly,
}

/**
 * Destructive tools require approval before running.
 * In non-interactive mode, this becomes a deny (see PolicyOptions).
 */
export const ASK_FOR_DESTRUCTIVE: PermissionRule = {
  name: 'ask-for-destructive',
  priority: 5,
  behavior: 'ask',
  reason: 'This operation is destructive and cannot be undone — please confirm',
  match: (req) => req.destructive,
}

/** The default built-in rules, in priority order. */
export const DEFAULT_RULES: PermissionRule[] = [
  ALLOW_READ_ONLY,
  ASK_FOR_DESTRUCTIVE,
]
