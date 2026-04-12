# 01 — The Loop

The loop is what makes an agent an agent.

---

## What most agents are

A one-shot prompt wrapper:

```
user message → system prompt + user message → model → response
```

That is not an agent. That is an API call with a fancy system prompt. It cannot use tools. It cannot retry on failure. It cannot continue until a task is done. It terminates after one response.

## What a real loop is

A real agent loop:

```
1. Build the current message list
2. Call the model
3. Stream or receive the response
4. If the model requested tool calls:
   a. Execute each tool (respecting permissions)
   b. Append the results to the message list
   c. Go to step 2
5. If the model is done (end_turn), exit
6. Handle error conditions, budget exhaustion, max iterations
```

This cycle — model → tools → results → model — is the fundamental unit of agentic behavior. Everything else is infrastructure around this cycle.

## Minimal implementation

```typescript
export async function* agentLoop(params: AgentLoopParams): AsyncGenerator<AgentEvent> {
  const { messages, systemPrompt, tools, permissions, model, maxIterations = 100 } = params
  let iteration = 0

  while (iteration < maxIterations) {
    iteration++

    // Call the model
    yield { type: 'model_request_start' }
    const response = await model.chat({ messages, systemPrompt, tools: tools.toDefinitions() })

    yield { type: 'model_response', message: response }
    messages.push({ role: 'assistant', content: response.content })

    // No tool calls — we're done
    if (!response.toolUses || response.toolUses.length === 0) {
      yield { type: 'done', reason: 'end_turn' }
      return
    }

    // Execute tool calls
    const toolResults = []
    for (const toolUse of response.toolUses) {
      yield { type: 'tool_request', toolUse }

      // Check permissions before executing
      const permission = await permissions.check({
        tool: toolUse.name,
        input: toolUse.input,
        ...tools.get(toolUse.name)?.safetyMeta,
      })

      if (permission.behavior === 'deny') {
        toolResults.push({ id: toolUse.id, error: `Permission denied: ${permission.reason}` })
        continue
      }

      // Execute the tool
      const result = await tools.execute(toolUse.name, toolUse.input)
      yield { type: 'tool_result', result }
      toolResults.push({ id: toolUse.id, content: result.output })
    }

    // Feed results back
    messages.push({ role: 'user', content: toolResults.map(r => ({ type: 'tool_result', ...r })) })
  }

  yield { type: 'done', reason: 'max_iterations' }
}
```

## What production-grade adds

- **Error recovery**: retry on transient failures, degrade gracefully on persistent ones
- **Streaming**: yield model tokens as they arrive, not just completed messages
- **Budget tracking**: token counting per iteration, exit before hitting context limits
- **Abort signals**: clean cancellation without orphaned tool calls
- **Event observability**: structured events for every state transition, not print statements
- **Subagent awareness**: the loop has an identity (`agentId`) so parent/child relationships work
- **Termination signals**: explicit stop tools that the model can call to signal task completion

## Anti-patterns to avoid

**The "think and respond" loop**: calling the model over and over with no way to invoke tools, just hoping more turns produces better output. This is not a loop. It is confusion.

**Uncapped iteration**: `while(true)` with no termination condition. Always set a max iteration limit. Always have an explicit terminal condition beyond "model says stop."

**Ignoring streaming errors**: a partial tool_use block from an interrupted stream will break the message history. Handle mid-stream errors by discarding partial state.

**Tool results without IDs**: every tool result must reference the tool_use_id it is responding to. Orphaned results break the API and confuse the model.
