# 06 — Context Management

Long-running agents fail without context management. This is not optional infrastructure.

---

## The problem

A model has a context window. It has gotten very large — 128k tokens, 200k tokens, 1M tokens in some cases. This has led to a false belief that context management is no longer necessary.

It is still necessary. Two reasons:

**Quality degrades as context fills.** Models lose track of earlier content as the window fills with recent content. Retrieval quality drops. Reasoning coherence drops. Hallucinations increase. The model does not uniformly process all 200k tokens with equal fidelity.

**Cost compounds with context size.** Every API call costs proportional to the total input tokens. An agent that accumulates 150k tokens of context over 30 iterations is spending 150k tokens per call even if 100k of it is irrelevant tool output from early iterations.

## Sliding windows

The simplest context management strategy: keep only the N most recent messages. Everything older than the window is dropped.

```typescript
const context = new ContextWindowManager({
  maxTokens: 200_000,
  compactionThreshold: 0.85,  // Compact when 85% full
  reservedForResponse: 8_192, // Always reserve 8k for model output
})
```

When the context window crosses the compaction threshold, the manager automatically keeps the first message (the initial task) and the most recent 40 messages, dropping the rest.

Pros: simple, predictable, cheap.
Cons: the agent loses access to early-conversation context that might still be relevant.

## Summarization

When a sliding window is too lossy, summarize before discarding. Pass a `SummarizationHook` to the manager:

```typescript
const context = new ContextWindowManager(
  {
    maxTokens: 200_000,
    compactionThreshold: 0.85,
  },
  {
    // Summarization hook — called when strategy is 'summarize' or 'hybrid'
    async summarize(messages) {
      // Call the model to summarize the old messages
      return await summarizeWithModel(messages)
    }
  }
)
```

Then compact with `'summarize'` or `'hybrid'` strategy:

```typescript
const compacted = await context.compact('summarize', messages)
```

Pros: retains semantic content from older turns.
Cons: requires an extra model call; the summary can lose detail.

Without a hook, `'summarize'` falls back to the sliding window automatically.

## Oversized tool result truncation

The most common source of context bloat is tool results. A `grep` that returns every line of every file. A `file_read` that returns a 50,000-line source file. A API response that includes the entire response body.

Every tool has a `maxResultSizeChars` constraint. The context manager enforces it:

```typescript
const truncated = context.truncateResult(rawOutput, tool.maxResultSizeChars)
```

The truncation message tells the model it has incomplete data and suggests a path to get more targeted information:

```
[Output truncated: showing 90000 of 120000 characters.
Use more specific tool inputs to reduce output size.]
```

## Token budgeting

The context manager tracks tokens across the conversation:

```typescript
const context = new ContextWindowManager({
  maxTokens: 200_000,
  warningThreshold: 0.7,     // isNearLimit() returns true at 70%
  compactionThreshold: 0.85, // needsCompaction() returns true at 85%
  reservedForResponse: 8_192, // Always reserve 8k for model output
})

// The loop calls these before each model call:
context.needsCompaction()  // true → compact before calling model
context.isNearLimit()      // true → consider reducing tool verbosity
context.getTokenCount()    // current estimated token count
```

The loop checks `needsCompaction()` before each iteration. If true, it compacts before calling the model.

## Anti-patterns to avoid

**No budget tracking**: running until the API returns a context-too-long error, then failing without recovery. Track tokens proactively.

**Truncating without notification**: silently cutting tool results. Always tell the model when results have been truncated.

**Compacting the wrong messages**: discarding recent context and keeping stale early context. Prefer to compact oldest messages first.

**Variable-length compaction intervals**: compacting every iteration "just in case." Compaction is expensive (it requires a model call). Gate it behind a threshold check.
