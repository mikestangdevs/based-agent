/**
 * Starter Agent — your starting point for building a Based Agent.
 *
 * This template wires all 7 systems with sensible defaults.
 * Customize each section with comments pointing to what to change.
 *
 * Getting started:
 *   1. Add your API key to .env (see .env.example)
 *   2. Edit AGENT_CONTEXT.md with your project context
 *   3. Register the tools your agent needs
 *   4. Configure permission rules for your use case
 *   5. Update baseInstructions to give your agent its role
 *   6. Run: npx tsx src/index.ts
 */

import * as readline from 'node:readline/promises'
import {
  createAgent, createModelAdapter,
  ToolRegistry, FileReadTool, GrepTool,
  PermissionPolicy,
  MemoryLoader,
  ContextWindowManager,
  PromptBuilder,
} from '../../../src/index.js'

async function main() {
  // ─────────────────────────────────────────────
  // SYSTEM 2: Tools
  // Register the tools your agent can use.
  // Every tool has readOnly, destructive, concurrencySafe, maxResultSizeChars.
  // ─────────────────────────────────────────────
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  tools.register(new GrepTool())
  // tools.register(new FileWriteTool())    // Add when you need file editing
  // tools.register(new ShellExecTool())    // Add when you need shell access
  // tools.register(new WebSearchTool())    // Add when you need web search

  // ─────────────────────────────────────────────
  // SYSTEM 3: Permissions
  // Define what your agent is allowed to do.
  // Default: read-only tools are auto-allowed, others require approval.
  // ─────────────────────────────────────────────
  const permissions = new PermissionPolicy()
  // Example: pre-approve specific operations
  // permissions.allow({
  //   name: 'allow-project-reads',
  //   priority: 50,
  //   reason: 'Reads in this project are safe',
  //   match: (req) => req.tool === 'file_read',
  // })
  // Example: block specific operations
  // permissions.deny({
  //   name: 'no-shell',
  //   priority: 200,
  //   reason: 'Shell disabled in this environment',
  //   match: (req) => req.tool === 'shell_exec',
  // })

  // ─────────────────────────────────────────────
  // SYSTEM 4: Memory
  // Loads AGENT_CONTEXT.md from the current directory.
  // Edit AGENT_CONTEXT.md to give your agent project context.
  // ─────────────────────────────────────────────
  const memory = await MemoryLoader.load({
    rootDir: process.cwd(),
    // taskContext: 'Additional inline context for this session',
    maxTotalChars: 50_000,
  })

  // ─────────────────────────────────────────────
  // SYSTEM 6: Context Management
  // Controls how the agent handles long conversations.
  // ─────────────────────────────────────────────
  const context = new ContextWindowManager({
    maxTokens: 200_000,         // Your model's context window
    compactionThreshold: 0.85,  // Compact at 85% full
    reservedForResponse: 8_192, // Reserve 8k for model output
  })

  // ─────────────────────────────────────────────
  // SYSTEM 7: Prompt Architecture
  // The prompt builder composes all layers into a stable system prompt.
  // ─────────────────────────────────────────────
  const prompts = new PromptBuilder()

  // ─────────────────────────────────────────────
  // Model adapter
  // Auto-detects from env: ANTHROPIC_API_KEY first, then OPENAI_API_KEY.
  // ─────────────────────────────────────────────
  const model = createModelAdapter()

  // ─────────────────────────────────────────────
  // SYSTEM 1: Agent Loop
  // Wires all 7 systems into a running agent.
  // ─────────────────────────────────────────────
  const agent = createAgent({
    // EDIT THIS: Give your agent its identity, role, and core behaviors.
    baseInstructions: `
      You are a helpful, focused assistant. Edit this to define your agent's role.
      
      Example roles:
      - A coding assistant that helps engineers understand and modify code
      - A research assistant that finds and synthesizes information
      - A data analyst that reads files and produces structured insights
      
      Be specific about what your agent does and how it should behave.
    `,
    tools,
    permissions,
    memory,
    context,
    prompts,
    model,
    maxIterations: 20,
  })

  console.log('Starter Agent running.')
  console.log(`Model: ${model.provider} / ${model.defaultModel}`)
  console.log(`Memory: ${memory.files.length} file(s) loaded`)
  console.log(`Tools: ${tools.list().map(t => t.name).join(', ')}`)
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  while (true) {
    const task = await rl.question('> ')
    if (!task.trim()) continue

    console.log()

    for await (const event of agent.run({ task })) {
      if (event.type === 'model_response') {
        const text = event.response.content
          .filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text)
          .join('')
        if (text) console.log(text)
      } else if (event.type === 'tool_request') {
        console.log(`  [${event.toolUse.name}]`)
      } else if (event.type === 'permission_denied') {
        console.log(`  [Blocked: ${event.reason}]`)
      } else if (event.type === 'done') {
        console.log(`\n[done: ${event.reason}]`)
      } else if (event.type === 'error') {
        console.error('[error]', event.error)
      }
    }

    console.log()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
