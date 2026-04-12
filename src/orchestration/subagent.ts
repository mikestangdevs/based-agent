/**
 * Subagent — spawns and manages a child agent with its own context.
 *
 * The key design decision: subagents are context boundaries.
 * Before spawning, decide what context the subagent should have:
 *   - 'none':    clean slate — just the task
 *   - 'summary': a compressed view of the parent's history
 *   - 'full':    the parent's complete message history
 *
 * Default to 'none' for self-contained delegations.
 * Use 'summary' when the subagent needs awareness of prior work.
 * Use 'full' only when context loss is unacceptable.
 */

import { randomUUID } from 'node:crypto'
import { createAgent, type AgentConfig, type Message } from '../core/index.js'
import { ToolRegistry } from '../tools/index.js'
import { MemoryLoader } from '../memory/index.js'
import { ContextWindowManager } from '../context/index.js'
import { PromptBuilder } from '../prompts/index.js'
import type {
  SubagentHandle,
  SubagentParams,
  SubagentResult,
  SubagentStatus,
} from './types.js'

export class Subagent implements SubagentHandle {
  readonly id: string
  readonly task: string
  private _status: SubagentStatus = 'running'
  private _result: SubagentResult | undefined
  private readonly abortController = new AbortController()
  private readonly promise: Promise<SubagentResult>

  constructor(params: SubagentParams, parentConfig: AgentConfig, depth = 0) {
    this.id = randomUUID()
    this.task = params.task
    this._result = undefined
    this.promise = this.run(params, parentConfig, depth)
  }

  get status(): SubagentStatus { return this._status }
  get result(): SubagentResult | undefined { return this._result }

  async wait(): Promise<SubagentResult> {
    return this.promise
  }

  async cancel(): Promise<void> {
    this.abortController.abort()
    this._status = 'cancelled'
    await this.promise.catch(() => {/* expected */})
  }

  private async run(params: SubagentParams, parentConfig: AgentConfig, _depth: number): Promise<SubagentResult> {
    const toolsUsed: string[] = []
    let iterationCount = 0

    try {
      // Build subagent tool registry
      const tools = new ToolRegistry()
      const toolList = params.tools ?? parentConfig.tools.list()
      for (const tool of toolList) {
        tools.register(tool)
      }

      // Build subagent config
      const subConfig: AgentConfig = {
        ...parentConfig,
        tools,
        permissions: params.permissions ?? parentConfig.permissions,
        memory: await MemoryLoader.load({ rootDir: process.cwd() }),
        context: new ContextWindowManager({ maxTokens: 200_000 }),
        prompts: new PromptBuilder(),
        maxIterations: params.maxIterations ?? 50,
      }

      // Prepare initial messages based on context inheritance
      const messages = buildInitialMessages(params)

      const agent = createAgent(subConfig)
      const outputParts: string[] = []

      // Set up timeout
      let timeoutId: NodeJS.Timeout | undefined
      if (params.timeout) {
        timeoutId = setTimeout(() => {
          this.abortController.abort()
          this._status = 'timed_out'
        }, params.timeout)
      }

      try {
        for await (const event of agent.run({
          task: params.task,
          messages,
          signal: this.abortController.signal,
        })) {
          if (event.type === 'model_response') {
            iterationCount++
            const text = event.response.content
              .filter(c => c.type === 'text')
              .map(c => (c as { text: string }).text)
              .join('')
            if (text) outputParts.push(text)
          }

          if (event.type === 'tool_result') {
            toolsUsed.push(String(event.toolUseId))
          }

          if (event.type === 'done') break
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId)
      }

      const status = this._status === 'timed_out' ? 'timed_out' : 'completed'
      this._status = status === 'timed_out' ? 'timed_out' : 'completed'

      this._result = {
        output: outputParts.join('\n\n'),
        messages: messages,
        toolsUsed,
        iterationCount,
        status: status === 'timed_out' ? 'timed_out' : 'completed',
      }

      return this._result
    } catch (error) {
      this._status = 'failed'
      this._result = {
        output: `Subagent failed: ${error instanceof Error ? error.message : String(error)}`,
        messages: [],
        toolsUsed,
        iterationCount,
        status: 'failed',
      }
      return this._result
    }
  }
}

function buildInitialMessages(params: SubagentParams): Message[] {
  switch (params.inheritContext) {
    case 'full':
      return params.parentMessages ?? []
    case 'summary': {
      if (!params.parentMessages?.length) return []
      // Simple summary: take text from last 5 assistant messages
      const summaryLines = params.parentMessages
        .filter(m => m.role === 'assistant')
        .slice(-5)
        .flatMap(m => m.content.filter(c => c.type === 'text').map(c => (c as { text: string }).text))
      if (!summaryLines.length) return []
      return [{
        role: 'user',
        content: [{
          type: 'text',
          text: `[Context summary from parent agent]\n${summaryLines.join('\n\n')}`,
        }],
      }]
    }
    case 'none':
    default:
      return []
  }
}

// ---------------------------------------------------------------------------
// SubagentManager — spawn and track subagents
// ---------------------------------------------------------------------------

export class SubagentManager {
  private readonly active = new Map<string, SubagentHandle>()
  private readonly maxDepth: number
  private readonly currentDepth: number

  constructor(
    private readonly parentConfig: AgentConfig,
    options?: { maxDepth?: number; currentDepth?: number },
  ) {
    this.maxDepth = options?.maxDepth ?? 3
    this.currentDepth = options?.currentDepth ?? 0
  }

  /**
   * Spawn a subagent. Returns a handle to track and await it.
   * Throws if the maximum nesting depth would be exceeded.
   */
  spawn(params: SubagentParams): SubagentHandle {
    const nextDepth = this.currentDepth + 1
    if (nextDepth > this.maxDepth) {
      throw new Error(
        `Subagent nesting depth ${nextDepth} exceeds maximum of ${this.maxDepth}. ` +
        `Set maxDepth on SubagentManager to increase the limit.`,
      )
    }

    const agent = new Subagent(params, this.parentConfig, nextDepth)
    this.active.set(agent.id, agent)

    // Clean up when done
    agent.wait()
      .catch(() => {/* expected */})
      .finally(() => this.active.delete(agent.id))

    return agent
  }

  /**
   * List all currently active subagents.
   */
  listActive(): SubagentHandle[] {
    return Array.from(this.active.values())
  }

  /**
   * Cancel all active subagents.
   */
  async cancelAll(): Promise<void> {
    await Promise.all(Array.from(this.active.values()).map(a => a.cancel()))
  }
}
