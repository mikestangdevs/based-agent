/**
 * Core loop tests — verifies the agent terminates correctly and yields expected events.
 */

import { describe, it, expect } from 'vitest'
import { createAgent, type AgentConfig, type ModelAdapter } from '../index.js'
import { ToolRegistry, defineTool } from '../../tools/index.js'
import { PermissionPolicy } from '../../permissions/index.js'
import type { ApprovalHandler, ApprovalOutcome } from '../../permissions/approval.js'
import type { EventLogger } from '../../telemetry/index.js'
import { MemoryLoader } from '../../memory/index.js'
import { ContextWindowManager } from '../../context/index.js'
import { PromptBuilder } from '../../prompts/index.js'
import { z } from 'zod'

function makeConfig(overrides?: Partial<AgentConfig>): AgentConfig {
  const tools = new ToolRegistry()
  const permissions = new PermissionPolicy()
  const memory = { files: [], totalChars: 0, render: () => '' }
  const context = new ContextWindowManager({ maxTokens: 10_000 })
  const prompts = new PromptBuilder()

  // Mock model that responds once with text and then end_turn
  const model: ModelAdapter = {
    provider: 'mock',
    defaultModel: 'mock-1',
    countTokens: (text) => Math.ceil(text.length / 4),
    chat: async function* () {
      yield {
        type: 'message_complete' as const,
        response: {
          content: [{ type: 'text' as const, text: 'Task complete.' }],
          toolUses: [],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
    },
  }

  return { tools, permissions, memory, context, prompts, model, ...overrides }
}

describe('createAgent', () => {
  it('yields model_request_start and done events for a simple task', async () => {
    const agent = createAgent(makeConfig())
    const events = []

    for await (const event of agent.run({ task: 'Say hello' })) {
      events.push(event.type)
    }

    expect(events).toContain('model_request_start')
    expect(events).toContain('model_response')
    expect(events).toContain('done')
  })

  it('terminates with end_turn when model returns no tool calls', async () => {
    const agent = createAgent(makeConfig())
    let doneEvent = null

    for await (const event of agent.run({ task: 'Simple task' })) {
      if (event.type === 'done') doneEvent = event
    }

    expect(doneEvent).not.toBeNull()
    expect((doneEvent as { reason: string }).reason).toBe('end_turn')
  })

  it('terminates with max_iterations when loop exceeds limit', async () => {
    // Model always returns tool calls that the loop processes
    const infiniteModel: ModelAdapter = {
      provider: 'mock',
      defaultModel: 'mock',
      countTokens: () => 1,
      chat: async function* () {
        yield {
          type: 'message_complete' as const,
          response: {
            content: [{ type: 'tool_use' as const, id: 'tu_1', name: 'nonexistent_tool', input: {} }],
            toolUses: [{ id: 'tu_1', name: 'nonexistent_tool', input: {} }],
            stopReason: 'tool_use' as const,
            usage: { inputTokens: 5, outputTokens: 5 },
          },
        }
      },
    }

    const agent = createAgent(makeConfig({ model: infiniteModel, maxIterations: 3 }))
    const events = []

    for await (const event of agent.run({ task: 'Infinite loop' })) {
      events.push(event)
    }

    const done = events.find(e => e.type === 'done')
    expect(done).toBeDefined()
    expect((done as { reason: string }).reason).toBe('max_iterations')
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    const agent = createAgent(makeConfig())

    // Abort immediately
    controller.abort()

    const events = []
    for await (const event of agent.run({ task: 'Aborted task', signal: controller.signal })) {
      events.push(event)
    }

    const done = events.find(e => e.type === 'done')
    expect((done as { reason: string } | undefined)?.reason).toBe('user_abort')
  })
})

// ---------------------------------------------------------------------------
// Enterprise behavior tests
// ---------------------------------------------------------------------------

/** Helper: a tool that the permission policy will 'ask' about */
function makeAskTool(registry: ToolRegistry) {
  const tool = defineTool({
    name: 'ask_tool',
    description: 'A tool that requires approval',
    inputSchema: z.object({}),
    readOnly: false,
    destructive: true,
    concurrencySafe: false,
    maxResultSizeChars: 1000,
    async execute(_input, _ctx) { return { output: 'executed' } },
  })
  registry.register(tool)
}

/** Helper: model that calls a single tool then ends */
function makeToolCallingModel(toolName: string): ModelAdapter {
  let called = false
  return {
    provider: 'mock',
    defaultModel: 'mock',
    countTokens: () => 1,
    chat: async function* () {
      if (!called) {
        called = true
        yield {
          type: 'message_complete' as const,
          response: {
            content: [{ type: 'tool_use' as const, id: 'tu_ask', name: toolName, input: {} }],
            toolUses: [{ id: 'tu_ask', name: toolName, input: {} }],
            stopReason: 'tool_use' as const,
            usage: { inputTokens: 5, outputTokens: 5 },
          },
        }
      } else {
        yield {
          type: 'message_complete' as const,
          response: {
            content: [{ type: 'text' as const, text: 'Done.' }],
            toolUses: [],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 5, outputTokens: 2 },
          },
        }
      }
    },
  }
}

describe('ApprovalHandler', () => {
  it('allows tool when handler returns allow', async () => {
    const tools = new ToolRegistry()
    makeAskTool(tools)

    const permissions = new PermissionPolicy()
    permissions.ask({ name: 'ask-all-destructive', match: (r) => r.destructive, reason: 'needs approval', priority: 10 })

    const handler: ApprovalHandler = { approve: async () => 'allow' as ApprovalOutcome }

    const agent = createAgent(makeConfig({
      tools,
      permissions,
      model: makeToolCallingModel('ask_tool'),
      approvalHandler: handler,
    }))

    const events = []
    for await (const event of agent.run({ task: 'run ask tool' })) {
      events.push(event)
    }

    // Should NOT have a permission_denied event
    expect(events.some(e => e.type === 'permission_denied')).toBe(false)
    // Should have a successful tool_result
    const toolResult = events.find(e => e.type === 'tool_result')
    expect(toolResult).toBeDefined()
    expect((toolResult as { isError: boolean }).isError).toBe(false)
  })

  it('denies tool when handler returns deny', async () => {
    const tools = new ToolRegistry()
    makeAskTool(tools)

    const permissions = new PermissionPolicy()
    permissions.ask({ name: 'ask-all-destructive', match: (r) => r.destructive, reason: 'needs approval', priority: 10 })

    const handler: ApprovalHandler = { approve: async () => 'deny' as ApprovalOutcome }

    const agent = createAgent(makeConfig({
      tools,
      permissions,
      model: makeToolCallingModel('ask_tool'),
      approvalHandler: handler,
    }))

    const events = []
    for await (const event of agent.run({ task: 'run ask tool' })) {
      events.push(event)
    }

    expect(events.some(e => e.type === 'permission_denied')).toBe(true)
  })

  it('fails closed (deny) when no handler registered', async () => {
    const tools = new ToolRegistry()
    makeAskTool(tools)

    const permissions = new PermissionPolicy()
    permissions.ask({ name: 'ask-all-destructive', match: (r) => r.destructive, reason: 'needs approval', priority: 10 })

    // No approvalHandler
    const agent = createAgent(makeConfig({
      tools,
      permissions,
      model: makeToolCallingModel('ask_tool'),
    }))

    const events = []
    for await (const event of agent.run({ task: 'run ask tool' })) {
      events.push(event)
    }

    expect(events.some(e => e.type === 'permission_denied')).toBe(true)
  })
})

describe('circuit breaker', () => {
  it('stops with repeated_tool_failure after 3 consecutive tool errors', async () => {
    const tools = new ToolRegistry()
    let callCount = 0

    const failingTool = defineTool({
      name: 'bad_tool',
      description: 'Always fails',
      inputSchema: z.object({}),
      readOnly: true,
      destructive: false,
      concurrencySafe: true,
      maxResultSizeChars: 1000,
      async execute(_input, _ctx) {
        callCount++
        throw new Error('Tool always fails')
      },
    })
    tools.register(failingTool)

    const permissions = new PermissionPolicy()
    permissions.allow({ name: 'allow-bad-tool', match: () => true, reason: 'allowed', priority: 10 })

    const loopingModel: ModelAdapter = {
      provider: 'mock',
      defaultModel: 'mock',
      countTokens: () => 1,
      chat: async function* () {
        yield {
          type: 'message_complete' as const,
          response: {
            content: [{ type: 'tool_use' as const, id: `tu_${callCount}`, name: 'bad_tool', input: {} }],
            toolUses: [{ id: `tu_${callCount}`, name: 'bad_tool', input: {} }],
            stopReason: 'tool_use' as const,
            usage: { inputTokens: 5, outputTokens: 5 },
          },
        }
      },
    }

    const agent = createAgent(makeConfig({ tools, permissions, model: loopingModel }))
    const events = []
    for await (const event of agent.run({ task: 'keep failing' })) {
      events.push(event)
    }

    const done = events.find(e => e.type === 'done')
    expect((done as { reason: string }).reason).toBe('repeated_tool_failure')
    // Tool should have been called exactly 3 times
    expect(callCount).toBe(3)
  })
})

describe('token budget', () => {
  it('stops with budget_exceeded when cumulative tokens exceed budget', async () => {
    // We need the loop to attempt a second iteration so the budget check fires.
    // Use a model that calls a (non-existent) tool each time — the loop will
    // accumulate tokens from iteration 1 (15 tokens) and then check budget at
    // the top of iteration 2, where 15 > 1 triggers budget_exceeded.
    const loopingModel: ModelAdapter = {
      provider: 'mock',
      defaultModel: 'mock',
      countTokens: () => 1,
      chat: async function* () {
        yield {
          type: 'message_complete' as const,
          response: {
            content: [{ type: 'tool_use' as const, id: 'tu_budget', name: 'nonexistent_tool', input: {} }],
            toolUses: [{ id: 'tu_budget', name: 'nonexistent_tool', input: {} }],
            stopReason: 'tool_use' as const,
            // 10 + 5 = 15 tokens — exceeds budget of 1 on second iteration check
            usage: { inputTokens: 10, outputTokens: 5 },
          },
        }
      },
    }

    const agent = createAgent(makeConfig({
      model: loopingModel,
      tokenBudget: 1, // 15 cumulative after iter 1 → budget_exceeded at start of iter 2
    }))

    const events = []
    for await (const event of agent.run({ task: 'budget test' })) {
      events.push(event)
    }

    const done = events.find(e => e.type === 'done')
    expect((done as { reason: string }).reason).toBe('budget_exceeded')
  })
})

describe('EventLogger', () => {
  it('receives every event with a consistent runId', async () => {
    const receivedEvents: Array<{ runId: string; eventType: string }> = []

    const logger: EventLogger = {
      onEvent(runId, event) {
        receivedEvents.push({ runId, eventType: event.type })
      },
    }

    const agent = createAgent(makeConfig({ logger }))
    for await (const _ of agent.run({ task: 'log test' })) { /* consume */ }

    expect(receivedEvents.length).toBeGreaterThan(0)

    // All events should share the same runId
    const runIds = new Set(receivedEvents.map(e => e.runId))
    expect(runIds.size).toBe(1)

    // runId should be a UUID
    const [runId] = runIds
    expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)

    // Should have seen model_request_start, model_response, and done
    const types = receivedEvents.map(e => e.eventType)
    expect(types).toContain('model_request_start')
    expect(types).toContain('model_response')
    expect(types).toContain('done')
  })

  it('swallows logger errors without crashing the run', async () => {
    const crashingLogger: EventLogger = {
      onEvent() { throw new Error('Logger exploded') },
    }

    const agent = createAgent(makeConfig({ logger: crashingLogger }))
    const events = []
    for await (const event of agent.run({ task: 'logger crash test' })) {
      events.push(event)
    }

    // Run should complete normally despite logger throwing
    expect(events.some(e => e.type === 'done')).toBe(true)
  })
})
