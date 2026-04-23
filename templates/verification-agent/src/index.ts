/**
 * Verification Agent Template — adversarial testing with CI-friendly exit codes.
 *
 * Runs a verification specialist agent and streams all activity live:
 *   → tool calls as they happen
 *   → model text as each response arrives
 *   → final PASS/FAIL/PARTIAL verdict
 *
 * Exit codes:
 *   0 — VERDICT: PASS
 *   1 — VERDICT: FAIL  (or no verdict found)
 *   2 — VERDICT: PARTIAL
 *
 * Usage:
 *   # Interactive
 *   npm run template:verify
 *
 *   # CI / non-interactive
 *   npm run template:verify -- \
 *     --task "Added JWT auth middleware" \
 *     --files src/middleware/auth.ts
 */

import * as readline from 'node:readline/promises'
import { parseArgs } from 'node:util'
import {
  createAgent, createModelAdapter, type AgentConfig,
  ToolRegistry, FileReadTool, GrepTool, ShellExecTool,
  PermissionPolicy,
  MemoryLoader,
  ContextWindowManager,
  PromptBuilder,
  verificationSpecialist,
} from '../../../src/index.js'

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    task:    { type: 'string' },
    files:   { type: 'string', multiple: true },
    spec:    { type: 'string' },
    timeout: { type: 'string' },
  },
  strict: false,
})

// ---------------------------------------------------------------------------
// Verdict parsing
// ---------------------------------------------------------------------------

function parseVerdict(output: string): 'PASS' | 'FAIL' | 'PARTIAL' | null {
  const match = output.match(/^VERDICT:\s+(PASS|FAIL|PARTIAL)\s*$/m)
  return match ? (match[1] as 'PASS' | 'FAIL' | 'PARTIAL') : null
}

function verdictExitCode(verdict: 'PASS' | 'FAIL' | 'PARTIAL' | null): number {
  if (verdict === 'PASS')    return 0
  if (verdict === 'PARTIAL') return 2
  return 1
}

// ---------------------------------------------------------------------------
// Tool display
// ---------------------------------------------------------------------------

function formatToolCall(name: string, input: unknown): string {
  if (!input || typeof input !== 'object') return name
  const i = input as Record<string, unknown>
  const arg =
    String(i['command'] ?? i['path'] ?? i['pattern'] ?? i['query'] ?? '').slice(0, 80)
  return arg ? `${name}(${arg})` : name
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('┌──────────────────────────────────────────────┐')
  console.log('│  Based Agent — Verification Template         │')
  console.log('│  Adversarial testing with CI exit codes      │')
  console.log('└──────────────────────────────────────────────┘')
  console.log()

  let task = args['task']
  const filesModified = args['files'] as string[] | undefined
  const originalSpec  = args['spec']
  const timeoutMs     = args['timeout'] ? parseInt(args['timeout'] as string, 10) : 300_000

  // Interactive fallback
  if (!task) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    task = await rl.question('What was implemented? Describe the change > ')
    rl.close()
    if (!task.trim()) {
      console.error('No task provided.')
      process.exit(1)
    }
    console.log()
  }

  // --- Build the verification role params ---
  const roleParams = verificationSpecialist({ task, filesModified, originalSpec, timeout: timeoutMs })

  // --- Tools ---
  const tools = new ToolRegistry()
  tools.register(new FileReadTool())
  tools.register(new GrepTool())
  tools.register(new ShellExecTool())

  // --- Permissions: allow shell for builds and tests ---
  const permissions = new PermissionPolicy()
  permissions.allow({
    name: 'allow-shell-for-verification',
    match: (req) => req.tool === 'shell_exec',
    reason: 'Verification requires running builds, tests, and curl commands',
    priority: 80,
  })

  // --- Memory ---
  const memory = await MemoryLoader.load({
    rootDir: new URL('../..', import.meta.url).pathname,
  })

  // --- Context ---
  const context = new ContextWindowManager({
    maxTokens:            200_000,
    warningThreshold:     0.65,
    compactionThreshold:  0.85,
    reservedForResponse:  12_000,
  })

  // --- Agent config ---
  // The verification specialist role prompt becomes baseInstructions.
  // We run the agent directly (not via SubagentManager) so we can stream events live.
  const agentConfig: AgentConfig = {
    baseInstructions: roleParams.task,   // role behavioral contract
    tools,
    permissions,
    memory,
    context,
    prompts: new PromptBuilder(),
    model:   createModelAdapter(),
    maxIterations: 60,
  }

  const agent = createAgent(agentConfig)

  // --- Print task summary ---
  console.log(`Task:    ${task}`)
  if (filesModified?.length) {
    console.log(`Files:   ${filesModified.join(', ')}`)
  }
  console.log(`Timeout: ${Math.round(timeoutMs / 1000)}s`)
  console.log()
  console.log('Running adversarial verification...')
  console.log('─'.repeat(60))
  console.log()

  // --- Run and stream events live ---
  const textChunks: string[] = []
  let iterCount = 0
  let toolCount = 0

  try {
    for await (const event of agent.run({ task })) {
      switch (event.type) {
        case 'model_request_start':
          iterCount++
          // Show a subtle iteration tick so the user knows the model is thinking
          process.stderr.write(`\r  [thinking... step ${iterCount}]`)
          break

        case 'tool_request': {
          toolCount++
          // Clear the thinking line, then print the tool call
          process.stderr.write('\r' + ' '.repeat(40) + '\r')
          const display = formatToolCall(event.toolUse.name, event.toolUse.input)
          console.log(`  → ${display}`)
          break
        }

        case 'tool_result':
          // Show a brief result summary (first line only to avoid flooding)
          if (event.isError) {
            console.log(`    ✗ error: ${event.output.split('\n')[0]?.slice(0, 100)}`)
          }
          break

        case 'model_response': {
          // Clear the thinking indicator then print the text
          process.stderr.write('\r' + ' '.repeat(40) + '\r')
          const text = event.response.content
            .filter(c => c.type === 'text')
            .map(c => (c as { text: string }).text)
            .join('')
          if (text) {
            process.stdout.write(text + '\n')
            textChunks.push(text)
          }
          break
        }

        case 'permission_denied': {
          const tier = event.riskTier ? ` [${event.riskTier.toUpperCase()} RISK]` : ''
          console.log(`  ✗ Blocked${tier}: ${event.reason}`)
          if (event.rollbackGuidance) console.log(`    Guidance: ${event.rollbackGuidance}`)
          break
        }

        case 'context_near_limit':
          console.log(`  ⚠ Context at ${event.tokenCount}/${event.limit} tokens`)
          break

        case 'error':
          process.stderr.write('\r' + ' '.repeat(40) + '\r')
          console.error(`  [error] ${event.error.message}`)
          break

        case 'done':
          process.stderr.write('\r' + ' '.repeat(40) + '\r')
          if (event.reason !== 'end_turn') {
            console.log(`\n[Stopped: ${event.reason}]`)
          }
          break
      }
    }
  } catch (err) {
    console.error('\n[Fatal error]', err)
  }

  // --- Parse verdict and exit ---
  const fullOutput = textChunks.join('\n')
  const verdict = parseVerdict(fullOutput)

  console.log()
  console.log('─'.repeat(60))
  console.log(`Steps: ${iterCount} model calls, ${toolCount} tool calls`)
  console.log()

  if (!verdict) {
    console.error('Warning: no VERDICT line found in output. Treating as FAIL.')
  } else {
    const icon = verdict === 'PASS' ? '✓' : verdict === 'PARTIAL' ? '~' : '✗'
    console.log(`${icon} VERDICT: ${verdict}`)
  }

  process.exit(verdictExitCode(verdict))
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
