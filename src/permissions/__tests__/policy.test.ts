/**
 * Permission policy tests — verifies deny, allow, and ask behaviors.
 */

import { describe, it, expect } from 'vitest'
import { PermissionPolicy } from '../index.js'
import type { PermissionRequest } from '../index.js'

function makeRequest(overrides?: Partial<PermissionRequest>): PermissionRequest {
  return {
    tool: 'file_read',
    input: { path: './file.txt' },
    readOnly: true,
    destructive: false,
    context: { iteration: 1, messages: [] },
    ...overrides,
  }
}

describe('PermissionPolicy', () => {
  it('allows read-only tools by default', async () => {
    const policy = new PermissionPolicy()
    const decision = await policy.check(makeRequest({ readOnly: true }))
    expect(decision.behavior).toBe('allow')
  })

  it('asks for destructive tools by default (interactive)', async () => {
    const policy = new PermissionPolicy({ nonInteractive: false })
    const decision = await policy.check(makeRequest({ readOnly: false, destructive: true }))
    expect(decision.behavior).toBe('ask')
  })

  it('denies destructive tools in non-interactive mode', async () => {
    const policy = new PermissionPolicy({ nonInteractive: true, nonInteractiveDefault: 'deny' })
    const decision = await policy.check(makeRequest({ readOnly: false, destructive: true }))
    expect(decision.behavior).toBe('deny')
  })

  it('respects explicit deny rules over default allow', async () => {
    const policy = new PermissionPolicy()
    policy.deny({
      name: 'no-reads',
      priority: 200,
      reason: 'File reads blocked',
      match: (req) => req.tool === 'file_read',
    })

    const decision = await policy.check(makeRequest({ tool: 'file_read', readOnly: true }))
    expect(decision.behavior).toBe('deny')
    expect(decision.ruleName).toBe('no-reads')
  })

  it('respects explicit allow rules', async () => {
    const policy = new PermissionPolicy()
    policy.allow({
      name: 'allow-shell',
      priority: 50,
      reason: 'Shell is pre-approved',
      match: (req) => req.tool === 'shell_exec',
    })

    const decision = await policy.check(makeRequest({
      tool: 'shell_exec',
      readOnly: false,
      destructive: true,
    }))
    // The allow rule runs before the ask-for-destructive default
    expect(decision.behavior).toBe('allow')
  })

  it('removes rules by name', async () => {
    const policy = new PermissionPolicy()
    policy.removeRule('allow-read-only')

    // Without the allow-read-only rule, a read-only tool should fall through to default
    const decision = await policy.check(makeRequest({ readOnly: true }))
    // Default for interactive is 'ask'
    expect(decision.behavior).toBe('ask')
  })

  it('lists all rules', () => {
    const policy = new PermissionPolicy()
    const rules = policy.listRules()
    expect(rules.length).toBeGreaterThan(0)
    expect(rules.some(r => r.name === 'allow-read-only')).toBe(true)
  })
})
