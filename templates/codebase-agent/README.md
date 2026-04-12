# Codebase Agent Template

An agent that deeply understands a codebase — answers architecture questions, traces execution paths, explains unfamiliar code, and makes targeted edits with explicit permission gating.

## What this agent does

- Reads and indexes project structure on startup
- Answers questions about how the codebase works
- Makes targeted code edits (with approval)
- Traces function calls, type hierarchies, and data flow
- Reads git history and changelogs when relevant

## Setup

```bash
# 1. Add your API key
cp ../../.env.example ../../.env

# 2. Set the codebase root
export CODEBASE_ROOT=/path/to/your/project

# 3. Run from repo root
npm run template:codebase
```

## Customization checklist

- [ ] Set `CODEBASE_ROOT` env var to your actual project path
- [ ] Edit `AGENT_CONTEXT.md` with your project's architecture, conventions, and key files
- [ ] Adjust the permission policy — decide which file paths allow writes without prompt
- [ ] Configure `BLOCKED_PATHS` in `src/index.ts` to protect sensitive files

## Architecture decisions

**Permissions:** Reads are pre-approved across the project. Writes require on-approval (ask). Shell is denied — agents shouldn't run your test suite unsupervised.

**Memory:** `AGENT_CONTEXT.md` is where you document non-obvious things: architectural decisions not evident from the code, areas under active refactor, known gotchas.

**Context:** Code reading sessions accumulate a lot of tokens. The agent compacts aggressively to keep reasoning coherent over long sessions.

## Key patterns

```typescript
// Pre-approve reads in specific subdirectories only
permissions.allow({
  name: 'allow-src-reads',
  priority: 50,
  match: (req) => {
    const input = req.input as { path?: string }
    return req.tool === 'file_read' && (input.path?.startsWith('./src') ?? false)
  },
})

// Block writes to infrastructure files
permissions.deny({
  name: 'protect-infra',
  priority: 200,
  match: (req) => {
    const input = req.input as { path?: string }
    const path = input.path ?? ''
    return req.tool === 'file_write' && (
      path.includes('terraform/') ||
      path.includes('.github/') ||
      path.includes('Dockerfile')
    )
  },
})
```
