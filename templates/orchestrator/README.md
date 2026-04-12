# Orchestrator Agent Template

A task orchestrator that decomposes complex goals into focused subtasks and delegates each to a specialized subagent.

## What this agent does

- Receives a high-level task from the user
- Reads relevant context to understand the current state
- Decomposes the task into 2-5 focused subtasks
- Selects and spawns the right specialized subagent for each subtask
- Aggregates results into a coherent final output

## The 4 subagent roles

| Role | Tools | Good for |
|---|---|---|
| `researcher` | file_read, grep, web_search | Information gathering and synthesis |
| `coder` | file_read, file_write, grep | Code reading, edits, implementation |
| `reviewer` | file_read, grep | Security audits, code review, quality checks |
| `writer` | file_read, file_write | Documentation, READMEs, changelogs, reports |

## Setup

```bash
# 1. Add your API key
cp ../../.env.example ../../.env

# 2. Run from repo root
npm run template:orchestrator
```

## Example tasks

```
"Research best practices for JWT refresh token rotation, then write a security decision doc"
"Review the src/auth/ directory for issues, then fix any CRITICAL findings"
"Understand the payment flow and write a sequence diagram as a new markdown file"
"Research how our competitors handle rate limiting, then propose an implementation plan"
```

## How delegation works

The orchestrator outputs structured `DELEGATE:` blocks when it wants to spawn a subagent:

```
DELEGATE:
role: researcher
inherit_context: none
task: Find 3 examples of production JWT refresh token rotation implementations and note the key security properties each one enforces.
---
```

The system parses these, spawns the appropriate subagent, and returns the result to the orchestrator for aggregation.

## Customization checklist

- [ ] Edit each role's `baseInstructions` in `createRoleConfig()` to match your domain
- [ ] Add new roles if your workflow has distinct specialists (e.g., `tester`, `deployer`)
- [ ] Adjust `maxIterations` and `timeout` per role based on typical task complexity
- [ ] Configure pre-approved write paths in the `coder` role permissions

## Architecture decisions

**Context inheritance:** Defaults to `'none'` per subtask — each subagent gets a clean context. The task description is self-contained. This is almost always correct for parallel-style subtasks.

**Tool scoping:** Subagents get the minimum tools they need. A reviewer never gets `file_write`. A researcher never gets `shell_exec`. This limits the blast radius of unexpected behavior.

**Depth protection:** `SubagentManager` enforces `maxDepth: 3`. Subagents cannot spawn further subagents unless explicitly configured. Prevents runaway recursive delegation.
