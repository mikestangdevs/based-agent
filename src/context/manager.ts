/**
 * Context manager implementation.
 *
 * Tracks token usage, detects when compaction is needed, and applies
 * the configured strategy when the window fills up.
 *
 * Token counting: uses a character-based heuristic (chars / 4).
 * For production accuracy, replace countTokens() with tiktoken.
 */

import type { Message } from '../types.js'
import type {
  CompactionStrategy,
  ContextBudgetConfig,
  ContextManager,
  SummarizationHook,
} from './types.js'

const DEFAULT_WARNING = 0.7
const DEFAULT_COMPACT = 0.85
const DEFAULT_RESERVED = 8_192
const SLIDING_WINDOW_SIZE = 40 // Default: keep last 40 messages on sliding window

export class ContextWindowManager implements ContextManager {
  private readonly config: Required<ContextBudgetConfig>
  private estimatedTokens = 0
  private readonly summarizationHook: SummarizationHook | undefined

  constructor(config: ContextBudgetConfig, summarizationHook?: SummarizationHook) {
    this.config = {
      maxTokens: config.maxTokens,
      warningThreshold: config.warningThreshold ?? DEFAULT_WARNING,
      compactionThreshold: config.compactionThreshold ?? DEFAULT_COMPACT,
      reservedForResponse: config.reservedForResponse ?? DEFAULT_RESERVED,
    }
    this.summarizationHook = summarizationHook ?? undefined
  }

  track(message: Message): void {
    this.estimatedTokens += this.countMessageTokens(message)
  }

  getTokenCount(): number {
    return this.estimatedTokens
  }

  getMaxTokens(): number {
    return this.config.maxTokens
  }

  needsCompaction(): boolean {
    const available = this.config.maxTokens - this.config.reservedForResponse
    return this.estimatedTokens >= available * this.config.compactionThreshold
  }

  isNearLimit(): boolean {
    const available = this.config.maxTokens - this.config.reservedForResponse
    return this.estimatedTokens >= available * this.config.warningThreshold
  }

  async compact(strategy: CompactionStrategy, messages?: Message[]): Promise<Message[]> {
    if (!messages) return []

    switch (strategy) {
      case 'sliding_window':
        return this.slidingWindow(messages)
      case 'summarize':
        return this.summarize(messages)
      case 'hybrid':
        return this.hybrid(messages)
      default:
        return this.slidingWindow(messages)
    }
  }

  truncateResult(result: string, maxChars: number): string {
    if (result.length <= maxChars) return result

    const keepChars = Math.floor(maxChars * 0.9)
    return (
      result.slice(0, keepChars) +
      `\n\n[Output truncated: showing ${keepChars} of ${result.length} characters. ` +
      `Use more specific tool inputs to reduce output size.]`
    )
  }

  private slidingWindow(messages: Message[]): Message[] {
    if (messages.length <= SLIDING_WINDOW_SIZE) return messages

    // Always keep the first message (initial task) and the most recent N
    const first = messages[0]
    const recent = messages.slice(-SLIDING_WINDOW_SIZE)

    // Recalculate token count
    const kept = first && !recent.includes(first) ? [first, ...recent] : recent
    this.estimatedTokens = kept.reduce((sum, m) => sum + this.countMessageTokens(m), 0)

    return kept
  }

  private async summarize(messages: Message[]): Promise<Message[]> {
    if (!this.summarizationHook) {
      // No hook — fall back to sliding window
      return this.slidingWindow(messages)
    }

    // Keep recent messages intact; summarize the older portion
    const recentCount = Math.floor(SLIDING_WINDOW_SIZE / 2)
    const toSummarize = messages.slice(0, -recentCount)
    const recent = messages.slice(-recentCount)

    if (toSummarize.length === 0) return messages

    const summary = await this.summarizationHook.summarize(toSummarize)
    const summaryMessage: Message = {
      role: 'user',
      content: [{ type: 'text', text: `[CONTEXT SUMMARY — covers ${toSummarize.length} earlier messages]\n\n${summary}` }],
    }

    const kept = [summaryMessage, ...recent]
    this.estimatedTokens = kept.reduce((sum, m) => sum + this.countMessageTokens(m), 0)

    return kept
  }

  private async hybrid(messages: Message[]): Promise<Message[]> {
    // Use summarization if available, sliding window otherwise
    return this.summarizationHook
      ? this.summarize(messages)
      : this.slidingWindow(messages)
  }

  /** Rough token estimate: 1 token ≈ 4 characters */
  private countMessageTokens(message: Message): number {
    const text = message.content
      .map(c => {
        if (c.type === 'text') return c.text
        if (c.type === 'tool_result') return c.content
        if (c.type === 'tool_use') return JSON.stringify(c.input)
        return ''
      })
      .join('')
    return Math.ceil(text.length / 4)
  }
}
