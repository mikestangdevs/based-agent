/**
 * ContextWindowManager tests — verifies token tracking, compaction, and truncation.
 */

import { describe, it, expect } from 'vitest'
import { ContextWindowManager } from '../index.js'
import type { Message } from '../../types.js'

function makeTextMessage(text: string, role: 'user' | 'assistant' = 'user'): Message {
  return { role, content: [{ type: 'text', text }] }
}

describe('ContextWindowManager', () => {
  it('starts at zero tokens', () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000 })
    expect(ctx.getTokenCount()).toBe(0)
  })

  it('tracks tokens after tracking a message', () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000 })
    ctx.track(makeTextMessage('hello world')) // ~11 chars / 4 = 3 tokens
    expect(ctx.getTokenCount()).toBeGreaterThan(0)
  })

  it('isNearLimit returns false when under warning threshold', () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000, warningThreshold: 0.7 })
    ctx.track(makeTextMessage('x')) // 1 char
    expect(ctx.isNearLimit()).toBe(false)
  })

  it('isNearLimit returns true when over warning threshold', () => {
    const ctx = new ContextWindowManager({ maxTokens: 100, warningThreshold: 0.7, reservedForResponse: 0 })
    // 100 * 0.7 = 70 tokens threshold; 400 chars / 4 = 100 tokens > threshold
    ctx.track(makeTextMessage('x'.repeat(400)))
    expect(ctx.isNearLimit()).toBe(true)
  })

  it('needsCompaction returns false when under compaction threshold', () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000, compactionThreshold: 0.85 })
    ctx.track(makeTextMessage('hello'))
    expect(ctx.needsCompaction()).toBe(false)
  })

  it('needsCompaction returns true when over compaction threshold', () => {
    const ctx = new ContextWindowManager({ maxTokens: 100, compactionThreshold: 0.85, reservedForResponse: 0 })
    // threshold = 100 * 0.85 = 85 tokens; 400 chars / 4 = 100 tokens > threshold
    ctx.track(makeTextMessage('x'.repeat(400)))
    expect(ctx.needsCompaction()).toBe(true)
  })

  it('sliding window compaction keeps first message and trims middle', async () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000 })
    const messages: Message[] = Array.from({ length: 50 }, (_, i) =>
      makeTextMessage(`Message ${i}`, i % 2 === 0 ? 'user' : 'assistant'),
    )

    const compacted = await ctx.compact('sliding_window', messages)
    expect(compacted.length).toBeLessThan(messages.length)
    // First message should be preserved
    expect(compacted[0]).toStrictEqual(messages[0])
  })

  it('compact returns empty array when called with no messages', async () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000 })
    const result = await ctx.compact('sliding_window', [])
    expect(result).toHaveLength(0)
  })

  it('compact falls back to sliding_window when no summarizationHook on summarize strategy', async () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000 })
    const messages: Message[] = Array.from({ length: 50 }, (_, i) =>
      makeTextMessage(`Message ${i}`, 'user'),
    )
    const result = await ctx.compact('summarize', messages)
    // No hook configured, falls back to sliding window
    expect(result.length).toBeLessThanOrEqual(messages.length)
  })

  it('truncateResult returns full result when within budget', () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000 })
    const result = ctx.truncateResult('hello', 1000)
    expect(result).toBe('hello')
  })

  it('truncateResult truncates and appends notice when over budget', () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000 })
    const longOutput = 'x'.repeat(200)
    const result = ctx.truncateResult(longOutput, 50)
    expect(result.length).toBeLessThan(longOutput.length)
    expect(result).toContain('[Output truncated')
  })

  it('updates token count after compaction', async () => {
    const ctx = new ContextWindowManager({ maxTokens: 10_000 })
    const messages: Message[] = Array.from({ length: 60 }, (_, i) =>
      makeTextMessage('x'.repeat(20), i % 2 === 0 ? 'user' : 'assistant'),
    )
    for (const m of messages) ctx.track(m)

    const beforeTokens = ctx.getTokenCount()
    await ctx.compact('sliding_window', messages)
    const afterTokens = ctx.getTokenCount()

    expect(afterTokens).toBeLessThan(beforeTokens)
  })
})
