/**
 * Codebase Agent — deep codebase understanding with targeted editing.
 *
 * This template demonstrates:
 * - Path-scoped permission rules (reads pre-approved, writes require approval)
 * - Explicit path blocklists for sensitive files
 * - Project structure indexing on startup
 * - Session memory that persists understanding across questions
 * - Graceful handling of large file reads via context truncation
 *
 * Run from repo root: npm run template:codebase
 * Or point at another project: CODEBASE_ROOT=/path/to/project npm run template:codebase
 */

import * as readline from 'node:readline/promises'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
  createAgent, createModelAdapter,
  ToolRegistry, FileReadTool, FileWriteTool, GrepTool,
  PermissionPolicy,
  MemoryLoader,
  ContextWindowManager,
  PromptBuilder,
} from '../../../src/index.js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// The codebase root. Defaults to current directory.
// Override with: CODEBASE_ROOT=/path/to/project npm run template:codebase
const CODEBASE_ROOT = process.env.CODEBASE_ROOT ?? process.cwd()

// Paths that should never be written to, even with user approval.
// Add your infrastructure, secrets, and deployment configs here.
const BLOCKED_WRITE_PATHS = [
  '.github/',
  'terraform/',
  'Dockerfile',
  '.env',
  '.env.production',
  'package-lock.json',
  'pnpm-lock.yaml',
]

// Paths where writes are pre-approved without prompting (low-risk).
// Remove or tighten this list for higher-security environments.
const PRE_APPROVED_WRITE_PATHS = [
  'src/',
  'lib/',
  'app/',
  'pages/',
  'components/',
]

// ---------------------------------------------------------------------------
// Project structure indexer
// ---------------------------------------------------------------------------

async function buildProjectIndex(root: string): Promise<string> {
  const lines: string[] = [`Project root: ${root}`, '']
  const MAX_DEPTH = 3
  const SKIP = new Set(['node_modules', '.git', 'dist', '.next', 'coverage', '__pycache__', '.turbo'])

  async function walk(dir: string, depth: number, indent: string): Promise<void> {
    if (depth > MAX_DEPTH) return
    let entries: fs.Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue
      lines.push(`${indent}${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`)
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), depth + 1, indent + '  ')
      }
    }
  }

  await walk(root, 0, '')
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('┌──────────────────────────────────────────────┐')
  console.log('│  Based Agent — Codebase Agent Template       │')
  console.log('│  Deep understanding + targeted editing        │')
  console.log('└──────────────────────────────────────────────┘')
  console.log()

  // Index the project structure before the agent starts
  console.log(`Indexing: ${CODEBASE_ROOT}`)
  const projectIndex = await buildProjectIndex(CODEBASE_ROOT)
  const fileCount = (projectIndex.match(/📄/g) ?? []).length
  const dirCount = (projectIndex.match(/📁/g) ?? []).length
  console.log(`Found: ${fileCount} files, ${dirCount} directories`)
  console.log()

  // --- Tools ---
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  tools.register(new FileWriteTool())
  tools.register(new GrepTool())
  // Shell is intentionally excluded. Agents shouldn't run your test suite
  // or build pipeline unsupervised. Run commands yourself after review.

  // --- Permissions ---
  const permissions = new PermissionPolicy({
    nonInteractive: false, // Always a user at the terminal for this agent
  })

  // Block dangerous write targets — hard deny, no override
  permissions.deny({
    name: 'block-protected-paths',
    priority: 1000, // Highest priority — checked first
    reason: 'This path is protected and cannot be written by the agent',
    match: (req) => {
      if (req.tool !== 'file_write') return false
      const input = req.input as { path?: string }
      const filePath = input.path ?? ''
      return BLOCKED_WRITE_PATHS.some(blocked => filePath.includes(blocked))
    },
  })

  // Pre-approve reads anywhere in the project — no prompt needed
  permissions.allow({
    name: 'allow-all-reads',
    priority: 50,
    reason: 'Reads are always safe in this codebase agent',
    match: (req) => req.tool === 'file_read',
  })

  // Pre-approve grep anywhere
  permissions.allow({
    name: 'allow-grep',
    priority: 50,
    reason: 'Grep is always safe',
    match: (req) => req.tool === 'grep',
  })

  // Pre-approve writes in low-risk source directories
  permissions.allow({
    name: 'allow-src-writes',
    priority: 40,
    reason: 'Source directory writes pre-approved for this session',
    match: (req) => {
      if (req.tool !== 'file_write') return false
      const input = req.input as { path?: string }
      const filePath = input.path ?? ''
      return PRE_APPROVED_WRITE_PATHS.some(approved => filePath.startsWith(approved))
    },
  })

  // Everything else (writes to unlisted paths): user will be prompted
  // This is the default PermissionPolicy 'ask' behavior — no rule needed

  // --- Memory ---
  const agentContextDir = new URL('..', import.meta.url).pathname
  const memory = await MemoryLoader.load({
    rootDir: agentContextDir,
    taskContext: `
## Current Project Structure

${projectIndex}
    `,
    maxTotalChars: 60_000, // Allow more memory for large codebases
  })

  // --- Context ---
  // Codebase sessions are read-heavy and token-intensive.
  // Compact sooner to maintain reasoning coherence.
  const context = new ContextWindowManager({
    maxTokens: 200_000,
    warningThreshold: 0.60,
    compactionThreshold: 0.78,
    reservedForResponse: 8_192,
  })

  // --- Prompts ---
  const prompts = new PromptBuilder()

  // --- Model ---
  const model = createModelAdapter()

  // --- Agent ---
  const agent = createAgent({
    baseInstructions: `
      You are an expert software engineer who deeply understands this codebase.
      You have been given the project directory structure and can read any file.

      ## Your capabilities

      - Read files to understand implementation details
      - Use grep to find patterns, function definitions, type usages, and imports
      - Make targeted, precise edits to source files
      - Explain how systems work with specific references to the actual code

      ## How to answer questions

      **Architecture questions**: Read key files to understand the actual implementation,
      then explain it with reference to specific files and line ranges.

      **"How does X work?" questions**: Trace the actual execution path through the code.
      Don't guess — read the relevant files and explain what you see.

      **"Why is X done this way?" questions**: Check git comments, look for patterns
      in surrounding code, and look at what the code evolved from.

      **Edit requests**: 
      1. Always read the current file before editing
      2. Make the minimal change that accomplishes the goal
      3. After editing, explain exactly what changed and why
      4. Note any related files that may need to be updated

      ## Constraints

      - Never make edits without reading the current file state first
      - Never guess at type signatures or interfaces — read the actual types
      - If a path is blocked, say so and explain what alternative approaches exist
      - Working directory is set to: ${CODEBASE_ROOT}
    `,
    tools,
    permissions,
    memory,
    context,
    prompts,
    model,
    maxIterations: 40,
    workingDirectory: CODEBASE_ROOT,
  })

  console.log(`Project:     ${CODEBASE_ROOT}`)
  console.log(`Model:       ${model.provider} / ${model.defaultModel}`)
  console.log(`Memory:      ${memory.files.length} context file(s) loaded`)
  console.log(`Protected:   ${BLOCKED_WRITE_PATHS.join(', ')}`)
  console.log()
  console.log('Ask anything about the codebase. Ctrl+C to exit.')
  console.log()
  console.log('Examples:')
  console.log('  "How does authentication work?"')
  console.log('  "Where is the database connection initialized?"')
  console.log('  "Add error handling to the payment webhook handler"')
  console.log('  "Why does the cache invalidation logic work this way?"')
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  while (true) {
    const task = await rl.question('> ')
    if (!task.trim()) continue

    console.log()

    for await (const event of agent.run({ task })) {
      if (event.type === 'tool_request') {
        const input = event.toolUse.input as Record<string, unknown>
        const preview = event.toolUse.name === 'grep'
          ? `"${input.pattern}"`
          : (input.path as string ?? '')
        console.log(`  → ${event.toolUse.name}(${preview})`)
      } else if (event.type === 'permission_denied') {
        console.log(`  ✗ Blocked: ${event.reason}`)
      } else if (event.type === 'model_response') {
        const text = event.response.content
          .filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text)
          .join('')
        if (text) console.log(text)
      } else if (event.type === 'done') {
        if (event.reason !== 'end_turn') {
          console.log(`\n[${event.reason}]`)
        }
      } else if (event.type === 'error') {
        console.error('[Error]', event.error.message)
      }
    }

    console.log()
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
