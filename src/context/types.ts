/**
 * Context manager types — token budgeting and window management.
 */

import type { Message } from '../types.js'

// ---------------------------------------------------------------------------
// Budget configuration
// ---------------------------------------------------------------------------

export type ContextBudgetConfig = {
  /** Maximum total tokens in the context window */
  maxTokens: number

  /**
   * Fraction of maxTokens at which to emit a warning.
   * Default: 0.7 (70%)
   */
  warningThreshold?: number

  /**
   * Fraction of maxTokens at which to trigger compaction.
   * Default: 0.85 (85%)
   */
  compactionThreshold?: number

  /**
   * Tokens reserved for model output. The agent will compact
   * when inputTokens > maxTokens - reservedForResponse.
   * Default: 8192
   */
  reservedForResponse?: number
}

// ---------------------------------------------------------------------------
// Compaction strategies
// ---------------------------------------------------------------------------

export type CompactionStrategy =
  /** Keep only the N most recent messages (fast, lossy) */
  | 'sliding_window'
  /** Summarize old messages before discarding (slow, lossless semantics) */
  | 'summarize'
  /** Sliding window for recent, summarize for mid-range */
  | 'hybrid'

// ---------------------------------------------------------------------------
// Summarization hook
// ---------------------------------------------------------------------------

export interface SummarizationHook {
  /**
   * Summarize a list of messages into a single compact string.
   * Called by the context manager when strategy is 'summarize' or 'hybrid'.
   */
  summarize(messages: Message[]): Promise<string>
}

// ---------------------------------------------------------------------------
// Manager interface
// ---------------------------------------------------------------------------

export interface ContextManager {
  /** Track a new message — updates the token count */
  track(message: Message): void

  /** Get current estimated token count */
  getTokenCount(): number

  /** Get the configured maximum token limit */
  getMaxTokens(): number

  /** True if approaching the compaction threshold (default: 70% of max) */
  isNearLimit(): boolean

  /** True if the context needs compaction before the next model call */
  needsCompaction(): boolean

  /**
   * Compact the given messages using the configured strategy.
   * Returns the replacement message array.
   */
  compact(strategy: CompactionStrategy, messages?: Message[]): Promise<Message[]>

  /**
   * Truncate a tool result to fit within its budget.
   * Returns the (possibly truncated) result string.
   */
  truncateResult(result: string, maxChars: number): string
}
