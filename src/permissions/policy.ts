/**
 * Permission policy engine.
 *
 * Rules are evaluated in priority order (highest first).
 * The first matching rule wins.
 *
 * Default behavior (no matching rule):
 *   - Interactive: 'ask'
 *   - Non-interactive: uses nonInteractiveDefault (default: 'deny')
 */

import type {
  PermissionBehavior,
  PermissionDecision,
  PermissionRequest,
  PermissionRule,
  PolicyOptions,
} from './types.js'
import { DEFAULT_RULES } from './rules.js'

export class PermissionPolicy {
  private rules: PermissionRule[]
  private readonly options: Required<PolicyOptions>

  constructor(options?: PolicyOptions) {
    this.options = {
      nonInteractiveDefault: options?.nonInteractiveDefault ?? 'deny',
      nonInteractive: options?.nonInteractive ?? false,
    }

    // Start with built-in rules
    this.rules = [...DEFAULT_RULES]
  }

  /**
   * Add an allow rule. Checked before the default deny/ask rules.
   */
  allow(rule: Omit<PermissionRule, 'behavior'>): this {
    this.rules.push({ ...rule, behavior: 'allow' as const, priority: rule.priority ?? 20 })
    this.sortRules()
    return this
  }

  /**
   * Add a deny rule. Should have high priority (>10) to override defaults.
   */
  deny(rule: Omit<PermissionRule, 'behavior'>): this {
    this.rules.push({ ...rule, behavior: 'deny' as const, priority: rule.priority ?? 100 })
    this.sortRules()
    return this
  }

  /**
   * Add an ask rule (manual approval required).
   */
  ask(rule: Omit<PermissionRule, 'behavior'>): this {
    this.rules.push({ ...rule, behavior: 'ask' as const })
    this.sortRules()
    return this
  }

  /**
   * Remove a rule by name.
   */
  removeRule(name: string): boolean {
    const before = this.rules.length
    this.rules = this.rules.filter(r => r.name !== name)
    return this.rules.length < before
  }

  /**
   * Check a permission request against all rules.
   * Returns a decision with the behavior and reason.
   */
  async check(request: PermissionRequest): Promise<PermissionDecision> {
    // Find the first matching rule
    for (const rule of this.rules) {
      if (rule.match(request)) {
        let behavior: PermissionBehavior = rule.behavior

        // In non-interactive mode, 'ask' falls back to the configured default
        if (behavior === 'ask' && this.options.nonInteractive) {
          behavior = this.options.nonInteractiveDefault
        }

        return { behavior, reason: rule.reason, ruleName: rule.name }
      }
    }

    // No rule matched — apply default
    const defaultBehavior: PermissionBehavior = this.options.nonInteractive
      ? this.options.nonInteractiveDefault
      : 'ask'

    return {
      behavior: defaultBehavior,
      reason: 'No explicit rule matched — defaulting to ' + defaultBehavior,
    }
  }

  /**
   * List all registered rules (for debugging).
   */
  listRules(): PermissionRule[] {
    return [...this.rules]
  }

  private sortRules(): void {
    this.rules.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
  }
}
