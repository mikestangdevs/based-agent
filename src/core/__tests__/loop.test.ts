/**
 * Core loop tests — verifies the agent terminates correctly and yields expected events.
 */

import { describe, it, expect } from 'vitest'
import { createAgent, type AgentConfig, type ModelAdapter } from '../index.js'
import { ToolRegistry } from '../../tools/index.js'
import { PermissionPolicy } from '../../permissions/index.js'
import { MemoryLoader } from '../../memory/index.js'
import { ContextWindowManager } from '../../context/index.js'
import { PromptBuilder } from '../../prompts/index.js'

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
