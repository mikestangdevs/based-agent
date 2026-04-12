# 04 — Memory

Memory should make the agent smarter over time. Most memory implementations just make the prompt bigger.

---

## What most agents do wrong

The common approach to memory is a memory dump: store everything the agent has learned, inject it all into every system prompt, hope the model sorts it out.

Problems:
- Context grows unboundedly until it breaks
- Old, stale, or irrelevant memories get injected alongside relevant ones
- The model is distracted by noise and misses the signal
- No budget management — a large memory file can crowd out tool descriptions or task context

Memory should improve performance, not just exist.

## File-based memory first

The right starting point is not a vector database. It is a markdown file.

```
AGENT_CONTEXT.md       ← project-level context
```

This file lives at the root of the project. The agent loads it on startup and injects it into the system prompt. It is the minimum viable memory system, and it works extremely well for most use cases.

When a task grows complex, you add additional context files. When user preferences matter, you load from a user-level config. When you need semantic retrieval, you add that layer on top — not as the default.

## Layered memory

Memory loads in layers, from highest to lowest priority:

```
1. task       — inline context for the current task (highest priority)
2. project     — AGENT_CONTEXT.md at the project root
3. workspace   — nested AGENT_CONTEXT.md files in subdirectories
4. user        — ~/.based-agent/context.md (global user preferences)
```

Each layer is loaded, trimmed to its budget, and composed into a single `MemoryContext` that the prompt builder injects.

```typescript
const memory = await MemoryLoader.load({
  rootDir: process.cwd(),
  contextFileName: 'AGENT_CONTEXT.md',  // Default
  includeNested: true,                   // Walk subdirectories
  maxTotalChars: 50_000,                 // Budget cap across all layers
})
```

## What to put in AGENT_CONTEXT.md

```markdown
# Project Context

## What this project is
A TypeScript library for processing financial transactions.

## Architecture
- src/parser/   — transaction parsing
- src/validator/ — business rule validation
- src/reporter/ — output formatting

## Non-obvious conventions
- All monetary values are integers (cents, not dollars)
- Error codes are defined in src/constants/errors.ts
- The test database resets between each test suite

## Current goals
- Migrating from v1 to v2 API schema (see MIGRATION.md)
- Performance target: 10,000 transactions/second
```

The purpose is to document things that are *not derivable* from the code or git history. Code patterns, architecture, and file structure can all be read at runtime by the agent.

## Relevant retrieval vs. memory dumping

For v1, memory is fully injected from the files you configure. There is no semantic retrieval yet.

The v0.2 roadmap includes a retrieval hook:

```typescript
interface MemoryRetrievalHook {
  // Given the current task context, return relevant memory excerpts
  retrieve(query: string, memory: MemoryContext): Promise<string[]>
}
```

Until then: keep your `AGENT_CONTEXT.md` tight. Write for signal density, not completeness.

## Anti-patterns to avoid

**Memory as logging**: saving every conversation summary to memory. The agent accumulates noise. Memory should store non-obvious, persistent facts — not activity logs.

**No budget**: loading memory with no size constraint. A 100,000 character memory file will crowd out everything else in the system prompt.

**Stale memory**: facts in memory that contradict the current code state. Memory drifts. Always verify memory against live state before acting on it.

**Memory for code conventions**: "we use tabs not spaces," "we export with named exports." These are derivable from the code. Don't store them in memory — they'll go stale when the conventions change.
