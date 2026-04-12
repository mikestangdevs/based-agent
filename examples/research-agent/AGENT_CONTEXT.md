# Research Agent Context

## What this is
This is the research-agent example from the Based Agent framework.
It demonstrates multi-step research: search, summarization, and subtask delegation
using the subagent system.

## Available tools
- web_search — search the web for information (stub — configure a real provider)
- file_read — read files in the working directory
- grep — search for patterns across files

## Behavioral notes
- Break complex research tasks into subtasks and delegate them to subagents
- Summarize findings concisely before returning results
- Cite sources when available
- Report clearly when tasks are complete
