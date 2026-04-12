# Research Agent Template

A production-quality agent that searches the web, synthesizes sources, and produces structured research reports.

## What this agent does

- Accepts a research question or topic
- Breaks the question into sub-queries and searches each one
- Reads relevant local files when available
- Synthesizes findings into a structured report with sources
- Optionally delegates summarization to a focused subagent

## Setup

```bash
# 1. Add your API key
cp ../../.env.example ../../.env

# 2. Configure your web search provider (see src/search-provider.ts)

# 3. Run from repo root
npm run template:researcher
```

## Customization checklist

- [ ] Implement `WebSearchProvider` in `src/search-provider.ts` — plug in Tavily, Serper, Brave, or Exa
- [ ] Update `AGENT_CONTEXT.md` with your domain (e.g., focus on biotech, finance, legal)
- [ ] Adjust `MAX_SEARCH_ITERATIONS` in `src/index.ts` for cost vs. depth tradeoff
- [ ] Tune the report format in `baseInstructions` to match your output needs

## Architecture decisions

**Permissions:** All research tools are read-only — auto-allowed. No approval prompts.

**Subagents:** The main agent does retrieval. A dedicated summarizer subagent handles final report formatting. Separation of concerns: one agent retrieves, one formats.

**Memory:** `AGENT_CONTEXT.md` contains domain framing. Keeps the system prompt focused.

**Context:** 200k token window. Research sessions can be long — the agent compacts at 85%.

## Extending this template

```typescript
// Add a citation tracker
const citations: string[] = []

// Hook into tool results
if (event.type === 'tool_result') {
  // Extract URLs from search results and track them
}

// Add a domain-specific source filter
permissions.deny({
  name: 'block-unverified-sources',
  priority: 100,
  reason: 'Only search pre-approved domains',
  match: (req) => {
    const input = req.input as { query?: string }
    // Your domain filtering logic here
    return false
  },
})
```
