# Coding Agent Context

## What this is
This is the coding-agent example from the Based Agent framework.
It demonstrates file editing with tiered permission rules — read-only by default,
write operations require explicit permission elevation.

## Available tools
- file_read — read any file in the working directory
- file_write — write files (requires `allow_write` permission tier)
- grep — search for patterns across files
- shell_exec — run shell commands (requires `allow_exec` permission tier)

## Behavioral notes
- Always read a file before editing it
- Prefer surgical edits over full rewrites
- Confirm destructive operations before executing
- Report clearly when tasks are complete
