/**
 * Pipeline Agent — non-interactive batch processing.
 *
 * This template demonstrates:
 * - Non-interactive mode: no user prompts, deny all destructive by default
 * - Batch processing: read input files, process them, write outputs
 * - Explicit pre-approved write paths with deny-all fallback
 * - Structured exit codes for CI/CD integration
 * - Timeout protection for long-running batch jobs
 *
 * Run from repo root:
 *   npm run template:pipeline -- --input ./data/input --output ./data/output
 *   npm run template:pipeline -- --task "Summarize all .md files in ./docs"
 */

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
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): {
  task: string
  inputDir: string | undefined
  outputDir: string | undefined
  maxIterations: number
  dryRun: boolean
} {
  const args = argv.slice(2)
  let task = ''
  let inputDir: string | undefined
  let outputDir: string | undefined
  let maxIterations = 50
  let dryRun = false

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--task' && args[i + 1]) task = args[++i]!
    else if (args[i] === '--input' && args[i + 1]) inputDir = args[++i]!
    else if (args[i] === '--output' && args[i + 1]) outputDir = args[++i]!
    else if (args[i] === '--max-iterations' && args[i + 1]) maxIterations = parseInt(args[++i]!, 10)
    else if (args[i] === '--dry-run') dryRun = true
  }

  return { task, inputDir, outputDir, maxIterations, dryRun }
}

// ---------------------------------------------------------------------------
// Batch job builder — constructs the task from input/output dirs
// ---------------------------------------------------------------------------

async function buildBatchTask(inputDir: string, outputDir: string): Promise<string> {
  let files: string[]
  try {
    const entries = await fs.readdir(inputDir, { withFileTypes: true })
    files = entries.filter(e => e.isFile()).map(e => e.name)
  } catch {
    throw new Error(`Cannot read input directory: ${inputDir}`)
  }

  if (files.length === 0) throw new Error(`No files found in: ${inputDir}`)

  return `
    Process the following batch job:

    Input directory:  ${path.resolve(inputDir)}
    Output directory: ${path.resolve(outputDir)}

    Files to process (${files.length}):
    ${files.map(f => `  - ${f}`).join('\n')}

    For each file:
    1. Read the file from the input directory
    2. Process it according to your instructions (see system prompt)
    3. Write the result to the output directory with the same filename

    After processing all files, produce a brief summary:
    - Files processed successfully
    - Files that had errors
    - Any patterns or issues noticed across the batch
  `
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { task: cliTask, inputDir, outputDir, maxIterations, dryRun } = parseArgs(process.argv)

  // Must have either a task or input/output dirs
  if (!cliTask && (!inputDir || !outputDir)) {
    console.error('Usage: npm run template:pipeline -- --task "..." OR --input <dir> --output <dir>')
    console.error()
    console.error('Options:')
    console.error('  --task             Direct task string for the agent')
    console.error('  --input <dir>      Input directory for batch processing')
    console.error('  --output <dir>     Output directory for batch processing')
    console.error('  --max-iterations   Maximum agent loop iterations (default: 50)')
    console.error('  --dry-run          Read files but do not write any output')
    process.exit(1)
  }

  if (dryRun) console.log('[DRY RUN — no files will be written]')

  // Build the task
  let task: string
  if (cliTask) {
    task = cliTask
  } else {
    task = await buildBatchTask(inputDir!, outputDir!)
    // Ensure output directory exists
    await fs.mkdir(path.resolve(outputDir!), { recursive: true })
  }

  // --- Tools ---
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  if (!dryRun) tools.register(new FileWriteTool())
  tools.register(new GrepTool())
  // No shell — pipeline agents should not run arbitrary commands

  // --- Permissions ---
  // Non-interactive pipeline: everything must be pre-decided.
  // 'ask' becomes 'deny' automatically in non-interactive mode.
  const permissions = new PermissionPolicy({
    nonInteractive: true,
    nonInteractiveDefault: 'deny', // Fail-closed: unknown situations are blocked
  })

  // Pre-approve all reads
  permissions.allow({
    name: 'allow-reads',
    priority: 50,
    reason: 'Reads are always safe in pipeline mode',
    match: (req) => req.tool === 'file_read',
  })

  // Pre-approve grep
  permissions.allow({
    name: 'allow-grep',
    priority: 50,
    reason: 'Grep is always safe',
    match: (req) => req.tool === 'grep',
  })

  if (outputDir && !dryRun) {
    // Pre-approve writes ONLY to the configured output directory
    const resolvedOutputDir = path.resolve(outputDir)
    permissions.allow({
      name: 'allow-output-writes',
      priority: 40,
      reason: `Writes to ${resolvedOutputDir} are pre-approved for this pipeline`,
      match: (req) => {
        if (req.tool !== 'file_write') return false
        const input = req.input as { path?: string }
        const fullPath = path.resolve(input.path ?? '')
        return fullPath.startsWith(resolvedOutputDir)
      },
    })
  }

  // Everything else is denied (nonInteractiveDefault: 'deny' handles this)

  // --- Memory ---
  const agentContextDir = new URL('..', import.meta.url).pathname
  const memory = await MemoryLoader.load({
    rootDir: agentContextDir,
    taskContext: outputDir
      ? `Output directory: ${path.resolve(outputDir)}\nInput directory: ${path.resolve(inputDir ?? '.')}`
      : undefined,
  })

  // --- Context ---
  const context = new ContextWindowManager({
    maxTokens: 200_000,
    warningThreshold: 0.70,
    compactionThreshold: 0.85,
    reservedForResponse: 8_192,
  })

  // --- Prompts ---
  const prompts = new PromptBuilder()

  // --- Model ---
  const model = createModelAdapter()

  // --- Agent ---
  const agent = createAgent({
    baseInstructions: `
      You are a non-interactive batch processing agent. You run in a pipeline —
      there is no user to ask for clarification. Make reasonable decisions and
      document them in your output.

      ## Operating constraints

      - You cannot ask the user for clarification. Make a reasonable decision and note it.
      - You can only write to the pre-approved output directory. Do not write elsewhere.
      - If a file cannot be processed, skip it with a clear error message and continue.
      - Do not stop the batch because one file failed.

      ## Processing instructions

      <!-- CUSTOMIZE THIS SECTION for your use case -->

      Default behavior (replace with your specific processing logic):
      - For .md files: summarize the content in 3-5 bullet points
      - For .txt files: extract key entities and produce structured JSON
      - For .json files: validate the schema and report any issues
      - For other files: describe what the file contains

      ## Output format for each file

      Write outputs to the specified output directory with the same filename.
      After processing all files, print a processing summary to stdout.

      ## Error handling

      - File cannot be read: log the error, skip the file, continue
      - File is too large: process the first 50,000 characters, note truncation
      - File format unexpected: process best-effort, note the deviation
    `,
    tools,
    permissions,
    memory,
    context,
    prompts,
    model,
    maxIterations,
    workingDirectory: process.cwd(),
  })

  // --- Run ---
  console.log(`Model:      ${model.provider} / ${model.defaultModel}`)
  console.log(`Mode:       non-interactive pipeline`)
  console.log(`Max iters:  ${maxIterations}`)
  if (outputDir) console.log(`Output:     ${path.resolve(outputDir)}`)
  console.log()

  const start = Date.now()
  let exitCode = 0
  let toolCallCount = 0
  let writeCount = 0
  let deniedCount = 0

  const abortController = new AbortController()
  const TOTAL_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes max for whole pipeline
  const timeout = setTimeout(() => {
    console.error(`\n[TIMEOUT] Pipeline exceeded ${TOTAL_TIMEOUT_MS / 1000}s — aborting`)
    abortController.abort()
  }, TOTAL_TIMEOUT_MS)

  try {
    for await (const event of agent.run({ task, signal: abortController.signal })) {
      if (event.type === 'tool_request') {
        toolCallCount++
        const input = event.toolUse.input as Record<string, unknown>
        if (event.toolUse.name === 'file_write') {
          writeCount++
          console.log(`  [Write] ${input.path}`)
        } else if (event.toolUse.name === 'file_read') {
          console.log(`  [Read]  ${input.path}`)
        } else if (event.toolUse.name === 'grep') {
          console.log(`  [Grep]  "${input.pattern}"`)
        }
      } else if (event.type === 'permission_denied') {
        deniedCount++
        console.log(`  [Denied] ${event.toolName}: ${event.reason}`)
        exitCode = 1
      } else if (event.type === 'model_response') {
        const text = event.response.content
          .filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text)
          .join('')
        if (text) console.log(text)
      } else if (event.type === 'done') {
        const elapsed = ((Date.now() - start) / 1000).toFixed(1)
        console.log()
        console.log(`Pipeline complete: ${event.reason}`)
        console.log(`  Elapsed:    ${elapsed}s`)
        console.log(`  Tool calls: ${toolCallCount}`)
        console.log(`  Writes:     ${writeCount}`)
        console.log(`  Denied:     ${deniedCount}`)
        if (event.reason === 'max_iterations') {
          console.error('[WARNING] Pipeline hit max_iterations — may be incomplete')
          exitCode = 2
        }
      } else if (event.type === 'error') {
        console.error('[Pipeline error]', event.error.message)
        exitCode = 1
      }
    }
  } finally {
    clearTimeout(timeout)
  }

  process.exit(exitCode)
}

main().catch(err => {
  console.error('Fatal pipeline error:', err)
  process.exit(1)
})
