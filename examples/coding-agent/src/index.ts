/**
 * Coding Agent — file editing with permission checks.
 *
 * This example shows an agent configured for code modification tasks.
 * It uses file_read, file_write, grep, and shell_exec — with explicit
 * permission rules that require approval for writes and deny shell commands
 * outside the project directory.
 *
 * Run from the repo root:
 *   npm run example:coding
 */

import * as readline from 'node:readline/promises'
import {
  createAgent, createModelAdapter,
  ToolRegistry, FileReadTool, FileWriteTool, GrepTool, ShellExecTool,
  PermissionPolicy,
  MemoryLoader,
  ContextWindowManager,
  PromptBuilder,
} from '../../../src/index.js'

async function main() {
  console.log('┌─────────────────────────────────┐')
  console.log('│  Based Agent — Coding Example   │')
  console.log('└─────────────────────────────────┘')
  console.log()

  const projectRoot = process.cwd()

  // Tools: read, write, search, execute
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  tools.register(new FileWriteTool())
  tools.register(new GrepTool())
  tools.register(new ShellExecTool())

  // Permissions: opinionated for code editing
  const permissions = new PermissionPolicy({
    nonInteractive: false, // We have a user at the terminal
  })

  // Pre-approve reads anywhere in the project
  permissions.allow({
    name: 'allow-project-reads',
    priority: 50,
    reason: 'File reads in project are pre-approved',
    match: (req) => req.tool === 'file_read',
  })

  // Pre-approve grep everywhere
  permissions.allow({
    name: 'allow-grep',
    priority: 50,
    reason: 'Grep is pre-approved',
    match: (req) => req.tool === 'grep',
  })

  // Block shell commands entirely (too risky in automated coding context)
  permissions.deny({
    name: 'no-shell',
    priority: 200,
    reason: 'Shell execution is disabled in this coding agent — run commands manually',
    match: (req) => req.tool === 'shell_exec',
  })

  // Writes require approval (the default behavior for non-readOnly, non-destructive tools)
  // No rule needed — the default policy will 'ask' for file_write

  // Memory: load project context
  const memory = await MemoryLoader.load({
    rootDir: projectRoot,
    taskContext: `
      You are a coding assistant with access to file read/write tools. 
      When editing files, make targeted changes. Prefer small, precise edits.
      Always read a file before editing it.
    `,
  })

  const context = new ContextWindowManager({ maxTokens: 200_000 })
  const prompts = new PromptBuilder()
  const model = createModelAdapter()

  const agent = createAgent({
    baseInstructions: `
      You are an expert coding assistant. You help engineers read and modify code.
      
      When given a coding task:
      1. Read the relevant files first — understand before changing
      2. Make targeted, minimal edits
      3. Prefer editing over rewriting
      4. If you're unsure about a change, explain your reasoning
      5. After writing a file, confirm what changed
    `,
    tools,
    permissions,
    memory,
    context,
    prompts,
    model,
    maxIterations: 30,
  })

  console.log(`Project: ${projectRoot}`)
  console.log(`Model: ${model.provider} / ${model.defaultModel}`)
  console.log(`Memory: ${memory.files.length} context file(s)`)
  console.log()
  console.log('Describe a coding task. Ctrl+C to exit.')
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  while (true) {
    const task = await rl.question('> ')
    if (!task.trim()) continue

    console.log()

    for await (const event of agent.run({ task })) {
      switch (event.type) {
        case 'tool_request':
          console.log(`  → ${event.toolUse.name}(${JSON.stringify(event.toolUse.input).slice(0, 80)}...)`)
          break
        case 'permission_denied':
          console.log(`  ✗ Blocked: ${event.reason}`)
          break
        case 'model_response': {
          const text = event.response.content
            .filter(c => c.type === 'text')
            .map(c => (c as { text: string }).text)
            .join('')
          if (text) console.log(text)
          break
        }
        case 'done':
          console.log(`\n[${event.reason}]`)
          break
        case 'error':
          console.error('[Error]', event.error)
          break
      }
    }

    console.log()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
