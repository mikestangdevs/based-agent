# Contributing to Based Agent

The contribution bar is simple: **sharpen the spine, don't add complexity.**

---

## What we want

- Bug fixes
- Improvements to existing implementations that make them cleaner or more correct
- New built-in tools that meet the tool contract standard
- Documentation improvements
- Tests that cover real behaviors, not just coverage numbers

## What we don't want

- New abstractions that add indirection without adding clarity
- Features tied to a specific model provider
- UI, dashboards, or visualization layers
- Dependencies that aren't justified by clear value

## Setup

```bash
git clone https://github.com/mikestangdevs/based-agent
cd based-agent
npm install
cp .env.example .env   # add your ANTHROPIC_API_KEY or OPENAI_API_KEY
npm test
```

## Source structure

All source lives in `src/`. Each subdirectory is a system:

```
src/
  types.ts          — shared types used across all systems
  index.ts          — public barrel export
  core/             — agent loop, model adapters, errors
  tools/            — tool registry and built-in tools
  permissions/      — permission policy engine
  memory/           — file-based memory loader
  context/          — token budgeting and window management
  prompts/          — layered prompt composition
  orchestration/    — subagent spawning and management
```

## Adding a tool

1. Create a file in `src/tools/built-in/`
2. Implement the `Tool` interface from `src/tools/types.ts`
3. Fill in all safety metadata — `readOnly`, `destructive`, `concurrencySafe`, `maxResultSizeChars` are required
4. Add a test in `src/tools/__tests__/`
5. Export from `src/tools/index.ts`
6. Re-export from `src/index.ts`

## Pull request format

- One clear title: what does this change?
- Why: what problem does it solve?
- Testing: how was this verified?

No changelog entry required for v0.1.
