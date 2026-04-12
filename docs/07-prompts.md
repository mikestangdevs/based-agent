# 07 — Prompt Architecture

Prompts are an architecture, not a text box.

---

## What most agents do

Concatenate strings:

```typescript
const systemPrompt = `You are a helpful assistant.` +
  environment +
  `Here are your tools: ` + toolDescriptions +
  memory +
  `The user's task is: ` + task
```

This works at demo scale. It fails at production scale because:

- There is no structure — you cannot reason about what's in the prompt without reading the whole thing
- There are no stable seams — adding a new layer requires editing the composition logic
- There is no budget management — if memory is large, tools get crowded out
- There is no consistency — every agent in your system builds prompts differently
- It is not testable — the string is assembled at runtime with no intermediate checkpoints

## Prompts as layers

The system prompt should be built by composing named layers, in a defined order, with explicit budgets.

```
┌─────────────────────────────────────┐
│  Base instructions                  │  ← Identity, tone, operating rules
│  (static, always present)           │
├─────────────────────────────────────┤
│  Tool descriptions                  │  ← Auto-generated from tool registry
│  (generated, stable across turns)   │
├─────────────────────────────────────┤
│  Memory context                     │  ← Loaded from AGENT_CONTEXT.md
│  (loaded from disk, turn-stable)    │
├─────────────────────────────────────┤
│  Runtime context                    │  ← Date, git status, environment
│  (fresh per session)                │
├─────────────────────────────────────┤
│  Task context                       │  ← What the user asked for
│  (fresh per task)                   │
├─────────────────────────────────────┤
│  Constraints                        │  ← Safety rails, output format
│  (configurable)                     │
└─────────────────────────────────────┘
```

## The prompt builder

```typescript
const builder = new PromptBuilder()

const systemPrompt = builder.build({
  baseInstructions: `
    You are an expert coding assistant. You help engineers understand and
    modify codebases. You are direct, technical, and precise. You do not
    add unnecessary caveats or hedges.
  `,
  toolDescriptions: tools.toPromptDescriptions(),
  memoryContext: await memory.render(),
  runtimeContext: {
    date: new Date().toISOString().split('T')[0],
    workingDirectory: process.cwd(),
    gitBranch: await getGitBranch(),
  },
  taskContext: 'Refactor the authentication module to use the new JWT library',
  constraints: [
    'Always ask before making destructive changes',
    'Prefer targeted edits over full file rewrites',
  ],
})
```

## Role-specific prompts

Different roles need different prompts. An orchestrator agent should not have the same system prompt as a subagent doing file analysis.

Use the builder's `forRole` pattern:

```typescript
const orchestratorPrompt = builder.build({
  baseInstructions: ORCHESTRATOR_INSTRUCTIONS,
  // ... orchestrator-specific config
})

const analyzerPrompt = builder.build({
  baseInstructions: ANALYZER_INSTRUCTIONS,
  memoryContext: '',  // Analyzer doesn't need global project memory
  taskContext: specificFileToAnalyze,
})
```

## Memory injection

Memory is injected as a dedicated layer, not concatenated into base instructions. This allows:

- Separate token budgeting for memory vs. other layers
- Easy removal of the memory layer for roles that don't need it
- Stable cache keys — base instructions don't change when memory changes

## Prompt stability

Prompt caching is valuable. To take advantage of it, the early layers of your system prompt must be stable across turns.

Rules:
- `baseInstructions` — never changes. Put zero dynamic content here.
- `toolDescriptions` — only changes when the tool set changes.
- `memoryContext` — only changes when memory files change.
- `runtimeContext` — changes once per session (date, git status). Build it at session start, not per-message.
- `taskContext` — changes per task. This is the most volatile layer; put it last.

If you put dynamic content in early layers, you bust the cache on every turn and pay for full prompt processing every time.

## Anti-patterns to avoid

**Monolithic system prompts**: one 5,000 word string assembled at runtime with no structure. Nobody can maintain this.

**Dynamic content in stable layers**: injecting the current time into `baseInstructions`. Use `runtimeContext` for anything that changes.

**Tool descriptions in base instructions**: "You have access to the following tools: ..." written by hand in the system prompt. Generate tool descriptions from the tool registry — they stay in sync automatically.

**Missing constraints**: omitting safety rails because "the model will behave correctly." It will, until it doesn't. Explicit constraints in the prompt compound with the permission layer.
