/**
 * Research Agent — search, summarize, and delegate subtasks.
 *
 * This example shows:
 * - Web search (with a real provider stub)
 * - File read for reference material
 * - Summarization as a subtask via SubagentManager
 * - How to pass task context cleanly to a subagent
 *
 * Run from the repo root:
 *   npm run example:research
 */

import * as readline from 'node:readline/promises'
import {
  createAgent, createModelAdapter, type AgentConfig,
  ToolRegistry, FileReadTool, GrepTool, WebSearchTool,
  PermissionPolicy,
  MemoryLoader,
  ContextWindowManager,
  PromptBuilder,
  SubagentManager,
} from '../../../src/index.js'

async function main() {
  console.log('┌──────────────────────────────────┐')
  console.log('│  Based Agent — Research Example  │')
  console.log('└──────────────────────────────────┘')
  console.log()

  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  tools.register(new GrepTool())
  tools.register(new WebSearchTool()) // Stub — swap in Tavily, Serper, Brave, etc.

  const permissions = new PermissionPolicy()
  // Research tools are all read-only — auto-allowed by default policy

  const memory = await MemoryLoader.load({
    rootDir: process.cwd(),
    taskContext: 'You are a research assistant. You search, read, and synthesize information.',
  })

  const context = new ContextWindowManager({ maxTokens: 200_000 })
  const prompts = new PromptBuilder()
  const model = createModelAdapter()

  const agentConfig: AgentConfig = {
    baseInstructions: `
      You are a focused research assistant. You find, read, and synthesize information.
      
      Research approach:
      1. Search for information using web_search
      2. Read relevant files with file_read when local documents are relevant
      3. Synthesize findings into a clear, structured response
      4. Cite sources when available
      5. Flag when information may be incomplete or outdated
      
      When a research task is complex, break it into subtasks.
    `,
    tools,
    permissions,
    memory,
    context,
    prompts,
    model,
    maxIterations: 25,
  }

  const agent = createAgent(agentConfig)

  // Subagent manager — used to delegate summarization subtasks
  const subagents = new SubagentManager(agentConfig)

  console.log(`Model: ${model.provider} / ${model.defaultModel}`)
  console.log('Web search: stub (configure WebSearchProvider to use a real search API)')
  console.log()
  console.log('Examples:')
  console.log('  "What are the trade-offs between RAG and fine-tuning?"')
  console.log('  "Summarize the research on sparse attention mechanisms"')
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  while (true) {
    const task = await rl.question('> ')
    if (!task.trim()) continue

    console.log()

    // For research tasks that look like they need summarization,
    // delegate to a focused summarizer subagent at the end
    const needsSummary = task.toLowerCase().includes('summarize') ||
                         task.toLowerCase().includes('summary') ||
                         task.toLowerCase().includes('overview')

    // Run the main research agent
    const rawOutputParts: string[] = []

    for await (const event of agent.run({ task })) {
      if (event.type === 'tool_request') {
        console.log(`  → ${event.toolUse.name}: ${JSON.stringify(event.toolUse.input).slice(0, 80)}`)
      } else if (event.type === 'model_response') {
        const text = event.response.content
          .filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text)
          .join('')
        if (text) {
          rawOutputParts.push(text)
          console.log(text)
        }
      } else if (event.type === 'done') {
        console.log(`\n[${event.reason}]`)
      } else if (event.type === 'error') {
        console.error('[Error]', event.error)
      }
    }

    // If the task requested a summary, delegate to a focused summarizer
    if (needsSummary && rawOutputParts.length > 0) {
      const rawOutput = rawOutputParts.join('\n\n')

      console.log('\n[Delegating to summarizer subagent...]')

      const summarizerHandle = subagents.spawn({
        task: `
          Summarize the following research findings into a clear, structured response.
          Use bullet points for key findings. Include a 1-paragraph executive summary at the top.
          
          Research findings:
          ${rawOutput}
        `,
        tools: [],  // Summarizer doesn't need tools
        inheritContext: 'none', // Fresh context — task is self-contained
        maxIterations: 5,
        timeout: 60_000,
      })

      const summaryResult = await summarizerHandle.wait()
      console.log('\n--- Summary ---')
      console.log(summaryResult.output)
    }

    console.log()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
