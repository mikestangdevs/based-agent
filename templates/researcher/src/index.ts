/**
 * Researcher Agent — multi-step research with source synthesis.
 *
 * This template demonstrates:
 * - Web search with graceful stub fallback
 * - Multi-query research decomposition via system prompt
 * - Subagent delegation for final report formatting
 * - Source tracking across tool calls
 * - Structured, cited report output
 *
 * Run from repo root: npm run template:researcher
 */

import * as readline from 'node:readline/promises'
import {
  createAgent, createModelAdapter, type AgentConfig,
  ToolRegistry, FileReadTool, GrepTool, WebSearchTool, type WebSearchProvider, type WebSearchResult,
  PermissionPolicy,
  MemoryLoader,
  ContextWindowManager,
  PromptBuilder,
  SubagentManager,
} from '../../../src/index.js'

// ---------------------------------------------------------------------------
// Search Provider — plug in your real implementation here
// ---------------------------------------------------------------------------
// Options: Tavily (tavily.com), Serper (serper.dev), Brave Search, Exa (exa.ai)
//
// Example Tavily implementation:
//
// class TavilyProvider implements WebSearchProvider {
//   async search(query: string, maxResults: number): Promise<WebSearchResult[]> {
//     const res = await fetch('https://api.tavily.com/search', {
//       method: 'POST',
//       headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.TAVILY_API_KEY}` },
//       body: JSON.stringify({ query, max_results: maxResults, search_depth: 'advanced' }),
//     })
//     const data = await res.json() as { results: Array<{ title: string; url: string; content: string }> }
//     return data.results.map(r => ({ title: r.title, url: r.url, snippet: r.content }))
//   }
// }
//
// Then replace: new WebSearchTool()
// With:         new WebSearchTool(new TavilyProvider())

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MAX_SEARCH_ITERATIONS = 30  // More iterations = deeper research, more tokens
const REPORT_TIMEOUT_MS = 120_000 // 2 minutes max for report generation

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('┌──────────────────────────────────────────────┐')
  console.log('│  Based Agent — Researcher Template           │')
  console.log('│  Multi-step research with source synthesis   │')
  console.log('└──────────────────────────────────────────────┘')
  console.log()

  // --- Tools ---
  // Research is read-only. All tools auto-allowed by permission defaults.
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())       // Read local reference documents
  tools.register(new GrepTool())           // Search local codebases or text files
  tools.register(new WebSearchTool())      // Stub by default — see search provider above

  // --- Permissions ---
  // All research tools are readOnly: true → auto-allowed by default policy.
  // No explicit rules needed. Add deny rules here if needed (e.g., block specific domains).
  const permissions = new PermissionPolicy()

  // --- Memory ---
  const memory = await MemoryLoader.load({
    rootDir: new URL('..', import.meta.url).pathname,
    taskContext: undefined, // Task context is passed per-query, not globally
  })

  // --- Context ---
  // Research sessions can be long and tool-result-heavy.
  // Compact aggressively to keep reasoning quality high.
  const context = new ContextWindowManager({
    maxTokens: 200_000,
    warningThreshold: 0.65,    // Warn early — research sessions fill fast
    compactionThreshold: 0.82, // Compact before quality degrades
    reservedForResponse: 12_000, // Reports can be long — reserve more
  })

  // --- Prompts ---
  const prompts = new PromptBuilder()

  // --- Model ---
  const model = createModelAdapter()

  // --- Agent Config ---
  const agentConfig: AgentConfig = {
    baseInstructions: `
      You are a rigorous, systematic research agent. You find, verify, and synthesize information 
      from multiple sources into clear, well-structured reports.

      ## Research Protocol

      When given a research question:

      1. **Decompose** — Break the question into 2-4 specific, searchable sub-questions.
         Think about what you need to know to answer the full question.

      2. **Search systematically** — Use web_search for each sub-question separately.
         Don't try to answer everything with one broad search.
         Use file_read and grep to pull in any relevant local documents.

      3. **Evaluate sources** — Note where information comes from.
         Flag when a source seems unreliable, outdated, or contradictory.

      4. **Synthesize, don't dump** — The output is a synthesis, not a collection of snippets.
         Connect the findings. Identify what they mean together.

      5. **Acknowledge gaps** — If you couldn't find information on a sub-question, say so explicitly.
         Never fill gaps with speculation presented as fact.

      ## Output format

      Structure your final response as:

      ### Executive Summary
      [2-3 sentences that answer the core question]

      ### Key Findings
      - Finding 1 (confidence: high/medium/low)
      - Finding 2 ...

      ### Detail
      [Expanded analysis for findings that need more explanation]

      ### Sources & Limitations
      [What you found, where, and what you couldn't determine]

      ## Constraints

      - Cite sources inline when you have them
      - Distinguish between "found evidence for" and "inferred from"
      - When web search returns the stub response, acknowledge it and work from local files only
      - Stop researching when you have sufficient evidence — do not search indefinitely
    `,
    tools,
    permissions,
    memory,
    context,
    prompts,
    model,
    maxIterations: MAX_SEARCH_ITERATIONS,
  }

  const agent = createAgent(agentConfig)

  // Subagent manager — delegates final report formatting to a clean context
  const subagents = new SubagentManager(agentConfig)

  console.log(`Model:       ${model.provider} / ${model.defaultModel}`)
  console.log(`Memory:      ${memory.files.length} context file(s) loaded`)
  console.log(`Web search:  ${process.env.TAVILY_API_KEY ? 'Tavily (configured)' : 'Stub (configure a WebSearchProvider)'}`)
  console.log(`Max iters:   ${MAX_SEARCH_ITERATIONS}`)
  console.log()
  console.log('Enter a research question. Ctrl+C to exit.')
  console.log()
  console.log('Examples:')
  console.log('  "What are the production failure modes of LLM agents?"')
  console.log('  "Compare RAG vs fine-tuning for domain adaptation"')
  console.log('  "What context window management strategies exist beyond sliding windows?"')
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  while (true) {
    const question = await rl.question('Research question > ')
    if (!question.trim()) continue

    console.log()
    console.log(`Researching: "${question}"`)
    console.log('─'.repeat(60))

    const start = Date.now()
    const rawFindings: string[] = []
    let searchCount = 0
    let iterCount = 0

    // --- Run Research Agent ---
    for await (const event of agent.run({ task: question })) {
      if (event.type === 'model_request_start') {
        iterCount++
      } else if (event.type === 'tool_request') {
        if (event.toolUse.name === 'web_search') {
          searchCount++
          const input = event.toolUse.input as { query: string }
          console.log(`  [Search ${searchCount}] ${input.query}`)
        } else if (event.toolUse.name === 'file_read') {
          const input = event.toolUse.input as { path: string }
          console.log(`  [Read] ${input.path}`)
        } else if (event.toolUse.name === 'grep') {
          const input = event.toolUse.input as { pattern: string }
          console.log(`  [Grep] "${input.pattern}"`)
        }
      } else if (event.type === 'model_response') {
        const text = event.response.content
          .filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text)
          .join('')
        if (text) rawFindings.push(text)
      } else if (event.type === 'done') {
        console.log(`  [Done: ${event.reason} — ${iterCount} iterations, ${searchCount} searches, ${Date.now() - start}ms]`)
      } else if (event.type === 'error') {
        console.error('  [Research error]', event.error.message)
      }
    }

    // --- Delegate Report Formatting to a Subagent ---
    // The research agent may produce long, unstructured findings.
    // A fresh subagent with a clean context formats it into the final report.
    if (rawFindings.length > 0) {
      const rawText = rawFindings.join('\n\n')

      console.log()
      console.log('Formatting final report...')

      const reporterHandle = subagents.spawn({
        task: `
          You are a research editor. Your job is to format raw research findings into a clean,
          structured report. Do not add information — only reorganize and clarify what's already there.

          Original research question: "${question}"

          Raw findings from the research agent:
          ---
          ${rawText}
          ---

          Produce a final report structured as:

          ## Research Report: [question]

          ### Executive Summary
          [2-3 sentences answering the core question directly]

          ### Key Findings
          [Bulleted, each with confidence level: high / medium / low]

          ### Analysis
          [Expanded discussion of the most important findings]

          ### Sources & Limitations
          [What was found and from where; what couldn't be determined]

          Keep it sharp. Eliminate redundancy. Do not pad.
        `,
        tools: [],             // Report formatting needs no tools
        inheritContext: 'none', // Fresh context — raw findings are self-contained
        maxIterations: 8,
        timeout: REPORT_TIMEOUT_MS,
      })

      const report = await reporterHandle.wait()

      console.log()
      console.log('═'.repeat(60))
      console.log(report.output)
      console.log('═'.repeat(60))

      if (report.status !== 'completed') {
        console.log(`\n[Report generation ${report.status}]`)
      }
    } else {
      console.log('\n[No research output produced]')
    }

    console.log()
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
