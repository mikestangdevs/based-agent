# 05 — Subagents

Subagents are context boundaries, not just workers.

---

## The wrong mental model

Most people think of subagents as parallel workers: spawn N agents, give them each a piece of the task, combine the results.

This is not wrong, but it misses the more important dimension: **context inheritance**.

When you spawn a subagent, the most important decision is not "what should it do" — it's "what context should it have."

A subagent with too much context is expensive, noisy, and likely to be confused by irrelevant history.
A subagent with too little context will ask the wrong questions or produce the wrong results.
A subagent with *the right* context — a clean, focused preparation of the relevant inputs — will outperform both.

## When to fork context vs. start fresh

| Situation | Context inheritance |
|---|---|
| Subtask needs deep knowledge of prior work | `'full'` — inherit the full parent message history |
| Subtask is a self-contained delegation | `'summary'` — inherit a compressed summary |
| Subtask is completely independent | `'none'` — start with just the task description |

Default to `'summary'` or `'none'`. Starting with a full inherited context is rarely better than a well-crafted delegation message.

## Delegation patterns

```typescript
// Spawn a subagent with focused context
const summarizer = await subagents.spawn({
  task: `
    Summarize the following research notes into 3 key findings:
    
    ${researchNotes}
    
    Format as a bulleted list. Maximum 500 words.
  `,
  tools: [new FileReadTool()],  // Scoped tool access
  inheritContext: 'none',        // Fresh context — task is self-contained
  maxIterations: 10,
  timeout: 30_000,
})

const result = await summarizer.result
```

```typescript
// Subagent that needs project awareness
const reviewer = await subagents.spawn({
  task: 'Review the recent changes and identify potential issues',
  tools: [new FileReadTool(), new GrepTool()],
  inheritContext: 'summary',  // Knows what happened, not every message
  maxIterations: 20,
})
```

## Parallelism without chaos

Parallel subagents sound appealing. They can also produce:
- Race conditions on shared files
- Incoherent combined outputs when subagents contradict each other
- Token costs that scale with agent count, not task complexity
- Complex error handling when one subagent fails midway

v1 of this repo uses sequential subagents. Parallel execution is a v0.2 feature.

When you do parallelize: use tools with `concurrencySafe: true`, gate file writes behind coordination, and treat the parent agent as the single source of truth for the final state.

## Subagent scope

Subagents should receive a *scoped* tool set, not the full parent tool registry.

If a subagent's job is to read files and summarize them, it does not need `shell_exec`. Give it only what it needs. This limits the blast radius if the subagent does something unexpected.

```typescript
// Parent has full tool access
// Subagent gets minimal scoped access
const subagent = await subagents.spawn({
  task: 'Analyze the test results in ./test-output/',
  tools: [new FileReadTool(), new GrepTool()],  // Read-only, scoped
  permissions: new PermissionPolicy({ nonInteractiveDefault: 'deny' }),
  inheritContext: 'none',
})
```

## Anti-patterns to avoid

**Subagents calling subagents calling subagents**: deep delegation chains without budget tracking. Set a `maxDepth` on your orchestrator.

**Full context inheritance by default**: passing every message from the parent's history to every subagent. Start with `'none'` and add context explicitly when needed.

**No timeout**: subagents that can run indefinitely. Always set a timeout. A stuck subagent should not hang the parent indefinitely.

**No error handling**: assuming the subagent will succeed. It won't, always. Handle failures at the delegation site.
