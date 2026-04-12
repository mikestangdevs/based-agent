# Orchestrator Agent — Context

## What this orchestrator manages

<!-- Edit for your use case -->
This orchestrator coordinates research, coding, review, and writing tasks.

## Domain context

<!-- Add any domain-specific framing that should apply to all subagents -->

## Decomposition heuristics

When breaking tasks into subtasks, prefer:
- Tasks that are independently completable (no shared state)
- Tasks that map cleanly to a single subagent role
- A maximum of 4-5 subtasks per request

## Output standards

- Research outputs: structured findings with confidence levels
- Code outputs: minimal diffs with explanations
- Review outputs: severity-ranked findings list
- Writing outputs: match existing docs format and tone
