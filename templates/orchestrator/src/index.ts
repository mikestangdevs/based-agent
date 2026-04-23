/**
 * Orchestrator Agent — task decomposition with specialized subagents.
 *
 * This template demonstrates the full subagent system:
 * - A planner agent that decomposes the task into subtasks
 * - Specialized subagents for each subtask (with scoped tools + permissions)
 * - A `delegate` tool that spawns subagents INSIDE the agent loop, so
 *   results are fed back into the conversation naturally
 * - Context inheritance strategies (none / summary / full)
 * - Recursive depth protection via SubagentManager
 *
 * Run from repo root: npm run template:orchestrator
 */

import * as readline from 'node:readline/promises'
import { z } from 'zod'
import {
  createAgent, createModelAdapter, defineTool, type AgentConfig,
  ToolRegistry, FileReadTool, FileWriteTool, GrepTool, WebSearchTool,
  PermissionPolicy,
  MemoryLoader,
  ContextWindowManager,
  PromptBuilder,
  SubagentManager,
  ConversationSummarizer,
  type Tool,
} from '../../../src/index.js'
import type { ToolContext } from '../../../src/index.js'

// ---------------------------------------------------------------------------
// Subagent role definitions
// ---------------------------------------------------------------------------
// Each role gets its own tools, permissions, and system prompt.
// The orchestrator selects which role to use for each subtask.

type SubagentRole = 'researcher' | 'coder' | 'reviewer' | 'writer'

interface RoleConfig {
  name: string
  description: string
  tools: ToolRegistry
  permissions: PermissionPolicy
  baseInstructions: string
  maxIterations: number
  timeout: number
}

function createRoleConfig(role: SubagentRole): RoleConfig {
  switch (role) {
    case 'researcher': {
      const tools = new ToolRegistry()
      tools.register(new FileReadTool())
      tools.register(new GrepTool())
      tools.register(new WebSearchTool())

      const permissions = new PermissionPolicy({ nonInteractive: true, nonInteractiveDefault: 'deny' })
      permissions.allow({ name: 'allow-reads', priority: 50, reason: 'Reads are safe', match: (r) => r.tool === 'file_read' })
      permissions.allow({ name: 'allow-grep', priority: 50, reason: 'Grep is safe', match: (r) => r.tool === 'grep' })
      permissions.allow({ name: 'allow-search', priority: 50, reason: 'Search is safe', match: (r) => r.tool === 'web_search' })

      return {
        name: 'Researcher',
        description: 'Finds and synthesizes information from files and web search',
        tools,
        permissions,
        baseInstructions: `
          You are a focused research agent. You find relevant information and synthesize it clearly.
          - Search web and read local files to answer the research question
          - Produce a structured response with key findings
          - Cite sources and note confidence levels
          - Be concise — your output goes to an orchestrator, not an end user
        `,
        maxIterations: 20,
        timeout: 120_000,
      }
    }

    case 'coder': {
      const tools = new ToolRegistry()
      tools.register(new FileReadTool())
      tools.register(new FileWriteTool())
      tools.register(new GrepTool())

      const permissions = new PermissionPolicy({ nonInteractive: false }) // Writes need approval
      permissions.allow({ name: 'allow-reads', priority: 50, reason: 'Reads always safe', match: (r) => r.tool === 'file_read' })
      permissions.allow({ name: 'allow-grep', priority: 50, reason: 'Grep always safe', match: (r) => r.tool === 'grep' })
      // Writes go through default 'ask' behavior — user approves each one

      return {
        name: 'Coder',
        description: 'Reads files, writes code changes, explains what changed',
        tools,
        permissions,
        baseInstructions: `
          You are a focused coding agent. You make targeted, precise code changes.
          - Always read the current file before editing it
          - Make the minimal change that solves the problem
          - After writing, explain exactly what changed and why
          - Note any related files that may need corresponding updates
        `,
        maxIterations: 25,
        timeout: 180_000,
      }
    }

    case 'reviewer': {
      const tools = new ToolRegistry()
      tools.register(new FileReadTool())
      tools.register(new GrepTool())

      const permissions = new PermissionPolicy()
      permissions.allow({ name: 'allow-reads', priority: 50, reason: 'Reads always safe', match: (r) => r.tool === 'file_read' })
      permissions.allow({ name: 'allow-grep', priority: 50, reason: 'Grep always safe', match: (r) => r.tool === 'grep' })

      return {
        name: 'Reviewer',
        description: 'Reviews code/documents for issues, inconsistencies, and improvements',
        tools,
        permissions,
        baseInstructions: `
          You are a careful reviewer. You read files and identify issues.
          
          Look for:
          - Logic errors and edge cases
          - Security issues (injection, path traversal, auth bypasses)
          - Type errors or missing null checks  
          - Performance problems (N+1 queries, unbounded loops)
          - Missing error handling
          - Documentation/code mismatches

          Format your output as a list of findings:
          - CRITICAL: [issue] — [file:line] — [recommendation]
          - HIGH: ...
          - MEDIUM: ...
          - LOW: ...
          - PASS: [what you checked and found to be OK]
        `,
        maxIterations: 20,
        timeout: 120_000,
      }
    }

    case 'writer': {
      const tools = new ToolRegistry()
      tools.register(new FileReadTool())
      tools.register(new FileWriteTool())

      const permissions = new PermissionPolicy()
      permissions.allow({ name: 'allow-reads', priority: 50, reason: 'Reads always safe', match: (r) => r.tool === 'file_read' })

      return {
        name: 'Writer',
        description: 'Produces documentation, summaries, changelogs, and structured reports',
        tools,
        permissions,
        baseInstructions: `
          You are a technical writer. You produce clear, precise documentation.
          - Read source material carefully before writing
          - Match the tone and format of existing documentation
          - Be specific — vague documentation is worse than no documentation
          - Never invent APIs, features, or behaviors not present in the source
        `,
        maxIterations: 15,
        timeout: 90_000,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Delegate tool — wraps SubagentManager.spawn() as a real tool
// ---------------------------------------------------------------------------
// Using a tool (rather than parsing text output) means delegation results
// are fed back into the conversation naturally through the message history.
// The orchestrator sees the result and can synthesize, aggregate, or ask for
// corrections — all within the same loop.

function createDelegateTool(subagentMgr: SubagentManager): Tool {
  const schema = z.object({
    role: z.enum(['researcher', 'coder', 'reviewer', 'writer']).describe(
      'Which specialized agent to delegate to. researcher=info gathering, coder=code editing, reviewer=auditing, writer=documentation.',
    ),
    task: z.string().describe(
      'The specific, self-contained task for the subagent. Include all context it needs — it cannot ask you for clarification.',
    ),
    inherit_context: z.enum(['none', 'summary', 'full']).optional().describe(
      'Context inheritance: none (fresh start, default), summary (compressed history), full (complete history).',
    ),
  })

  return defineTool({
    name: 'delegate',
    description: [
      'Delegate a subtask to a specialized subagent and get the result back.',
      'The subagent runs independently and returns its output to you.',
      'Use this when a subtask requires specialized tools or a focused context.',
      'Do NOT delegate trivial tasks you can do yourself in 1-2 steps.',
    ].join(' '),
    inputSchema: schema,
    readOnly: false,
    destructive: false,
    concurrencySafe: false,
    maxResultSizeChars: 50_000,

    async execute(input: z.infer<typeof schema>, _context: ToolContext) {
      const roleConfig = createRoleConfig(input.role)
      const inheritContext = input.inherit_context ?? 'none'

      console.log(`\n  ┌─ Subagent: ${roleConfig.name}`)
      console.log(`  │  Context: ${inheritContext}`)
      console.log(`  │  Task: ${input.task.slice(0, 120)}${input.task.length > 120 ? '...' : ''}`)

      const handle = subagentMgr.spawn({
        task: input.task,
        tools: roleConfig.tools.list(),
        inheritContext,
        maxIterations: roleConfig.maxIterations,
        timeout: roleConfig.timeout,
      })

      const result = await handle.wait()
      console.log(`  └─ ${result.status} (${result.iterationCount} iters)`)

      if (result.status === 'failed') {
        return { output: `[${roleConfig.name} failed]: ${result.output}` }
      }
      if (result.status === 'timed_out') {
        return { output: `[${roleConfig.name} timed out after ${roleConfig.timeout / 1000}s. Partial output:]\n${result.output}` }
      }

      return { output: `[${roleConfig.name} result]:\n${result.output}` }
    },
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('┌──────────────────────────────────────────────────┐')
  console.log('│  Based Agent — Orchestrator Template             │')
  console.log('│  Task decomposition with specialized subagents   │')
  console.log('└──────────────────────────────────────────────────┘')
  console.log()

  const model = createModelAdapter()

  // --- Memory ---
  const agentContextDir = new URL('..', import.meta.url).pathname
  const memory = await MemoryLoader.load({ rootDir: agentContextDir })

  // --- Orchestrator agent config (without tools yet — we need subagentMgr first) ---
  const orchestratorConfig: AgentConfig = {
    baseInstructions: `
      You are a task orchestrator. You receive complex tasks and decompose them into focused
      subtasks executed by specialized agents. You direct, synthesize, and verify — you are
      the brain of the operation.

      ## Your 4-Phase Workflow

      ### Phase 1: Research (parallel workers)
      Dispatch delegate calls simultaneously to gather information. Each explores independently.
      All research tasks are read-only and safe to run concurrently.

      ### Phase 2: Synthesis (YOU — not a worker)
      This is your responsibility alone. Read every finding. Understand the problem space.
      Identify the right approach. Craft detailed specifications for the next phase.
      NEVER hand raw findings to another worker and say "figure it out."
      NEVER write phrases like "based on what you discovered" — that delegates your comprehension.
      Instead: cite specific file paths, line numbers, and exactly what needs to change.

      ### Phase 3: Implementation (workers)
      Send workers to execute the plan you synthesized. Provide them with everything they need:
      file paths, line numbers, exact changes, success criteria. Write-heavy tasks should run
      one at a time per file set to avoid conflicts.

      ### Phase 4: Verification (workers)
      Dispatch a reviewer to confirm correctness. Real verification means:
      - Run the test suite with the new feature active
      - Be skeptical — probe edge cases and failure modes
      - Test independently — do not rubber-stamp a worker's self-assessment

      ## Available subagent roles

      - **researcher**: Finds and synthesizes information. Good for: gathering data, background research, answering "what is X?" questions.
      - **coder**: Reads and edits code files. Good for: implementing features, fixing bugs, refactoring.
      - **reviewer**: Reviews files for issues. Good for: security audits, code review, quality checks.
      - **writer**: Produces documentation. Good for: READMEs, changelogs, API docs, summaries.

      ## Worker Prompt Construction (CRITICAL)

      Workers cannot see your conversation with the user. Every prompt you write for a worker
      must be entirely self-contained. Include:
      - File paths and line numbers relevant to the task
      - The exact change or finding you need
      - What "done" looks like — concrete completion criteria
      - For implementation tasks: include "run tests then verify" as the last step
      - For research tasks: include "report your findings — do not modify any files"

      ## Concurrency

      Parallelism is your greatest advantage. Dispatch independent workers at the same time
      whenever possible. Read-only research tasks can always run concurrently.

      ## Handling Failures

      When a worker fails, the error context is in the result. Diagnose before re-delegating.
      If a second attempt also fails, try a fundamentally different strategy.

      ## Output Format

      After synthesis, present:
      - Objective and acceptance criteria
      - Task board (role, status, what it found/did)
      - Verified findings
      - Decisions made and next actions

      ## Constraints

      - Do not delegate when you can do it yourself in 1-2 tool calls
      - Each subagent runs independently — give them all context they need
      - Use inherit_context: 'none' for self-contained tasks (most cases)
      - Use inherit_context: 'summary' when the subagent needs prior context
      - Maximum 3 delegation depth (enforced automatically)
      - Worker results are internal signals — synthesize them for the user, do not relay raw output
    `,
    // Tools are set below after subagentMgr is created
    tools: new ToolRegistry(),
    permissions: new PermissionPolicy(),
    memory,
    context: new ContextWindowManager(
      {
        maxTokens: 200_000,
        compactionThreshold: 0.80,
        reservedForResponse: 12_000,
      },
      new ConversationSummarizer(model), // Hybrid compaction: summarize old, keep recent
    ),
    prompts: new PromptBuilder(),
    model,
    maxIterations: 60,
  }

  // --- Subagent infrastructure ---
  const subagentMgr = new SubagentManager(orchestratorConfig, { maxDepth: 3 })

  // --- Wire in tools now that subagentMgr exists ---
  const orchestratorTools = new ToolRegistry()
  orchestratorTools.register(new FileReadTool())
  orchestratorTools.register(new GrepTool())
  orchestratorTools.register(new WebSearchTool())
  orchestratorTools.register(createDelegateTool(subagentMgr))

  // Orchestrator permissions: reads are free, writes need approval
  const orchestratorPermissions = new PermissionPolicy()
  orchestratorPermissions.allow({
    name: 'allow-reads',
    priority: 50,
    reason: 'Reads are always safe',
    match: (r) => r.tool === 'file_read' || r.tool === 'grep' || r.tool === 'web_search',
  })
  orchestratorPermissions.allow({
    name: 'allow-delegate',
    priority: 50,
    reason: 'Delegation is pre-approved',
    match: (r) => r.tool === 'delegate',
  })

  // Apply tools and permissions to the config object
  orchestratorConfig.tools = orchestratorTools
  orchestratorConfig.permissions = orchestratorPermissions

  const orchestratorAgent = createAgent(orchestratorConfig)

  // --- UI ---
  console.log(`Model:      ${model.provider} / ${model.defaultModel}`)
  console.log(`Memory:     ${memory.files.length} context file(s) loaded`)
  console.log(`Max depth:  3 subagent delegation levels`)
  console.log()
  console.log('Subagent roles:')
  console.log('  researcher — info gathering and synthesis')
  console.log('  coder      — file reading and code editing')
  console.log('  reviewer   — code review and auditing')
  console.log('  writer     — documentation and reports')
  console.log()
  console.log('Give the orchestrator a complex task. Ctrl+C to exit.')
  console.log()
  console.log('Examples:')
  console.log('  "Research the pros/cons of Zod vs Valibot, then write a decision doc"')
  console.log('  "Review the src/ directory for security issues, then fix any CRITICAL ones"')
  console.log('  "Understand the authentication flow and write a sequence diagram in a new file"')
  console.log()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  while (true) {
    const task = await rl.question('Orchestrator > ')
    if (!task.trim()) continue

    console.log()

    for await (const event of orchestratorAgent.run({ task })) {
      if (event.type === 'tool_request') {
        if (event.toolUse.name !== 'delegate') {
          // delegate tool prints its own progress
          const input = event.toolUse.input as Record<string, unknown>
          console.log(`  → ${event.toolUse.name}(${String(input.path ?? input.query ?? input.pattern ?? '').slice(0, 60)})`)
        }
      } else if (event.type === 'model_response') {
        const text = event.response.content
          .filter(c => c.type === 'text')
          .map(c => (c as { text: string }).text)
          .join('')
        if (text) console.log(text)
      } else if (event.type === 'permission_denied') {
        const tier = event.riskTier ? ` [${event.riskTier.toUpperCase()} RISK]` : ''
        console.log(`  ✗ Blocked${tier}: ${event.reason}`)
        if (event.rollbackGuidance) {
          console.log(`    Guidance: ${event.rollbackGuidance}`)
        }
      } else if (event.type === 'done') {
        if (event.reason !== 'end_turn') {
          console.log(`\n[Orchestrator: ${event.reason}]`)
        }
      } else if (event.type === 'error') {
        console.error('[Orchestrator error]', event.error.message)
      }
    }

    console.log()
  }
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
