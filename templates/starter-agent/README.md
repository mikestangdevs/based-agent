# Starter Agent

A clean starting point for building your own agent with Based Agent.

## Setup

```bash
# 1. Copy .env.example and add your API key
cp ../../.env.example ../../.env

# 2. Install dependencies (from the repo root)
cd ../..
npm install

# 3. Edit AGENT_CONTEXT.md with your project context

# 4. Edit src/index.ts to configure your agent

# 5. Run
npx tsx src/index.ts
```

## Customization checklist

- [ ] Set `baseInstructions` — give your agent its role and behavioral rules
- [ ] Register tools — add only what your agent needs
- [ ] Configure permissions — pre-approve safe operations, block unsafe ones
- [ ] Fill out `AGENT_CONTEXT.md` — project context, architecture, conventions

## Architecture

This template wires all 7 Based Agent systems:

1. **Loop** — drives the model ↔ tool ↔ result cycle
2. **Tools** — `ToolRegistry` with `FileReadTool` and `GrepTool` pre-registered
3. **Permissions** — `PermissionPolicy` with safe defaults
4. **Memory** — `MemoryLoader` reads `AGENT_CONTEXT.md`
5. **Subagents** — not included by default, add `SubagentManager` when needed
6. **Context** — `ContextWindowManager` with 200k token window
7. **Prompts** — `PromptBuilder` composes all layers into a stable system prompt

## Adding more tools

```typescript
import { FileWriteTool, ShellExecTool, WebSearchTool } from '../../../src/index.js'

tools.register(new FileWriteTool())   // Write files
tools.register(new ShellExecTool())   // Run shell commands (destructive — requires approval)
tools.register(new WebSearchTool())   // Search the web (provide a real WebSearchProvider)
```

## Adding subagent delegation

```typescript
import { SubagentManager } from '../../../src/index.js'

const subagents = new SubagentManager(agentConfig)

const handle = subagents.spawn({
  task: 'Summarize the research findings',
  tools: [],
  inheritContext: 'none',
  timeout: 30_000,
})

const result = await handle.wait()
```
