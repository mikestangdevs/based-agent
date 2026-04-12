/**
 * Minimal Agent — the simplest possible working example.
 *
 * This example shows all 7 systems wired together with minimal configuration.
 * It runs an interactive loop that accepts tasks from stdin and runs the agent.
 *
 * Run from the repo root:
 *   npm run example:minimal
 */

import * as readline from 'node:readline/promises'
import {
  createAgent, createModelAdapter,
  ToolRegistry, FileReadTool, GrepTool, WebSearchTool,
  PermissionPolicy,
  MemoryLoader,
  ContextWindowManager,
  PromptBuilder,
} from '../../../src/index.js'

async function main() {
  console.log('┌─────────────────────────────────┐')
  console.log('│  Based Agent — Minimal Example  │')
  console.log('└─────────────────────────────────┘')
  console.log()

  // --- 1. Tools ---
  // Register only the tools this agent needs. Every tool has explicit
  // safety metadata (readOnly, destructive, concurrencySafe).
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  tools.register(new GrepTool())
  tools.register(new WebSearchTool()) // Stub — replace with real provider

  // --- 2. Permissions ---
  // Read-only tools are auto-allowed. The default policy asks before
  // anything non-read-only. In non-interactive mode, set nonInteractive: true.
  const permissions = new PermissionPolicy()

  // Pre-approve grep in this project directory
  permissions.allow({
    name: 'allow-project-grep',
    priority: 50,
    reason: 'Grep in project directory is pre-approved',
    match: (req) => req.tool === 'grep',
  })

  // --- 3. Memory ---
  // Loads AGENT_CONTEXT.md from the current directory.
  // The file doesn't need to exist — returns empty context if not found.
  const memory = await MemoryLoader.load({
    rootDir: process.cwd(),
    taskContext: 'You are running in the minimal-agent example.',
  })

  console.log(`Memory: loaded ${memory.files.length} context file(s) (${memory.totalChars} chars)`)

  // --- 4. Context Manager ---
  // Manages the token window. Will compact at 85% of 200k tokens.
  const context = new ContextWindowManager({
    maxTokens: 200_000,
    compactionThreshold: 0.85,
    reservedForResponse: 8_192,
  })

  // --- 5. Prompt Builder ---
  const prompts = new PromptBuilder()

  // --- 6. Model ---
  // Auto-detects from env: ANTHROPIC_API_KEY first, then OPENAI_API_KEY.
  const model = createModelAdapter()
  console.log(`Model: ${model.provider} / ${model.defaultModel}`)

  // --- 7. Agent ---
  const agent = createAgent({
    baseInstructions: `
      You are a focused, capable assistant. You use tools to answer questions 
      and complete tasks. You are direct and precise. When a task is complete, 
      stop without unnecessary commentary.
    `,
    tools,
    permissions,
    memory,
    context,
    prompts,
    model,
    maxIterations: 20,
  })

  console.log(`Tools: ${tools.list().map(t => t.name).join(', ')}`)
  console.log()
  console.log('Type a task and press Enter. Ctrl+C to exit.')
  console.log()

  // Interactive REPL
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  while (true) {
    const task = await rl.question('> ')
    if (!task.trim()) continue

    console.log()
    const start = Date.now()

    for await (const event of agent.run({ task })) {
      if (event.type === 'model_request_start') {
        process.stdout.write(`[Iteration ${event.iteration}] `)
      } else if (event.type === 'tool_request') {
        process.stdout.write(`[Tool: ${event.toolUse.name}] `)
      } else if (event.type === 'tool_result') {
        process.stdout.write(event.isError ? '[Error] ' : '[Done] ')
      } else if (event.type === 'model_response') {
        const text = event.response.content
          .filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text)
          .join('')
        if (text) {
          console.log()
          console.log(text)
        }
      } else if (event.type === 'permission_denied') {
        console.log(`\n[Permission denied: ${event.reason}]`)
      } else if (event.type === 'done') {
        console.log(`\n[Done in ${Date.now() - start}ms — reason: ${event.reason}]`)
      } else if (event.type === 'error') {
        console.error('\n[Error]', event.error)
      }
    }

    console.log()
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
