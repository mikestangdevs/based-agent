# Based Agent

**An opinionated blueprint for building agents that actually work in production.**

Most agent frameworks make it easy to call a model. Few of them tell you what to build around the model. This repo does.

```
                         THE 7 SYSTEMS
     ┌──────────────────────────────────────────────────┐
     │                   agent loop                     │
     │                                                  │
     │  ┌──────────┐  ┌────────────┐  ┌─────────────┐   │
     │  │  tools   │  │permissions │  │   memory    │   │
     │  │ registry │  │   policy   │  │   loader    │   │
     │  └──────────┘  └────────────┘  └─────────────┘   │
     │                                                  │
     │  ┌──────────┐  ┌────────────┐  ┌─────────────┐   │
     │  │ subagent │  │  context   │  │   prompt    │   │
     │  │ manager  │  │  manager   │  │   builder   │   │
     │  └──────────┘  └────────────┘  └─────────────┘   │
     │                                                  │
     │  ┌──────────┐  ┌────────────┐  ┌─────────────┐   │
     │  │telemetry │  │  approval  │  │  run context │   │
     │  │  logger  │  │  handler   │  │   (run ID)   │   │
     │  └──────────┘  └────────────┘  └─────────────┘   │
     │                                                  │
     │               ┌────────────┐                     │
     │               │   model    │                     │
     │               │  adapter   │                     │
     │               └────────────┘                     │
     └──────────────────────────────────────────────────┘
```

Every serious agent has these seven systems — whether they were designed explicitly or accumulated accidentally. This repo makes them explicit, then adds the production-grade infrastructure layer on top.

---

## The 7 Systems

| System | Source | What it does |
|---|---|---|
| Loop | `src/core/` | Drives the model ↔ tool ↔ result cycle with typed events |
| Tools | `src/tools/` | Registry with input schemas, safety metadata, and path containment |
| Permissions | `src/permissions/` | Priority-ordered policy engine. Fail-closed by default. |
| Memory | `src/memory/` | 4-layer file-based context: task → project → workspace → user |
| Subagents | `src/orchestration/` | Task delegation with context boundaries and depth limits |
| Context | `src/context/` | Token budgeting, sliding window compaction, result truncation |
| Prompts | `src/prompts/` | Layered composition: instructions → tools → memory → runtime → task |

## Production Infrastructure

| System | Source | What it does |
|---|---|---|
| Run Identity | `src/core/run-context.ts` | UUID per run, propagated to every event — enables log correlation and audit trails |
| ApprovalHandler | `src/permissions/approval.ts` | Live human-in-the-loop approval for `ask`-tier tools (CLI, webhook, auto-approve for CI) |
| EventLogger | `src/telemetry/` | Tap point for every `AgentEvent` — wire to Datadog, LangSmith, NDJSON pipelines, etc. |
| Token Budget | `AgentConfig.tokenBudget` | Hard cost ceiling — loop halts with `budget_exceeded` before costs run away |
| Circuit Breaker | `src/core/loop.ts` | Auto-halts with `repeated_tool_failure` if the same tool errors 3× in a row |

---

## Get Started

### Prerequisites

- Node.js 20.6+
- An Anthropic or OpenAI API key

```bash
git clone https://github.com/mikestangdevs/based-agent
cd based-agent
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY or OPENAI_API_KEY
```

### Run an example

```bash
npm run example:minimal     # Simplest working agent — 3 tools, permissions, memory
npm run example:coding      # File editing with tiered permission rules
npm run example:research    # Search + summarization + subagent delegation
```

### Run a template

```bash
npm run template:starter       # Blank slate — all 7 systems wired, nothing else
npm run template:researcher    # Multi-step research with pluggable search provider
npm run template:codebase      # Codebase exploration with scoped path permissions
npm run template:orchestrator  # Task decomposition with 4 specialized subagents
npm run template:pipeline -- --task "Summarize docs/"  # Non-interactive batch mode
```

---

## What it looks like

Wire the 7 systems. Run the loop. Handle events.

```typescript
import {
  createAgent, createModelAdapter, defineTool,
  ToolRegistry, FileReadTool, FileWriteTool, GrepTool,
  PermissionPolicy,
  MemoryLoader,
  ContextWindowManager,
  PromptBuilder,
} from '../src/index.js'

// 1. Tools — what the agent can do
const tools = new ToolRegistry()
tools.register(new FileReadTool())
tools.register(new FileWriteTool())
tools.register(new GrepTool())

// 2. Permissions — what the agent is allowed to do
const permissions = new PermissionPolicy()
// Destructive tools require approval by default. No config needed.
// Add rules to open up or lock down specific tools:
// permissions.allow({ name: 'allow-writes', match: r => r.tool === 'file_write', reason: '...' })

// 3. Memory — what the agent knows before the task starts
const memory = await MemoryLoader.load({ rootDir: process.cwd() })
// Discovers AGENT_CONTEXT.md files at project, workspace, and user level.

// 4. Context — how the agent stays coherent on long runs
const context = new ContextWindowManager({ maxTokens: 200_000 })

// 5. Prompts — how the system prompt is composed
const prompts = new PromptBuilder()

// 6. Model — which provider and model to use
const model = createModelAdapter()  // auto-detects from env

// 7. Loop — everything wired together, with enterprise options
const agent = createAgent({
  tools, permissions, memory, context, prompts, model,

  // Production infrastructure (all optional, all backward-compatible)
  approvalHandler: new CliApprovalHandler(), // ask-tier tools → interactive y/N prompt
  logger: new ConsoleLogger(),               // structured JSON on every event → stderr
  tokenBudget: 100_000,                      // hard token ceiling → done: budget_exceeded
})

// Run and handle typed events
// Every event carries a runId for log correlation
for await (const event of agent.run({ task: 'Summarize the README' })) {
  if (event.type === 'model_response') {
    const text = event.response.content
      .filter(c => c.type === 'text')
      .map(c => (c as { text: string }).text)
      .join('')
    if (text) process.stdout.write(text)
  }
  if (event.type === 'tool_request')    console.log(`  → ${event.toolUse.name}`)
  if (event.type === 'permission_denied') console.log(`  ✗ Blocked: ${event.reason}`)
  if (event.type === 'context_near_limit') console.log(`  ⚠ Context at ${event.tokenCount}/${event.limit} tokens`)
  if (event.type === 'done') break
}
```

### Defining a custom tool

```typescript
import { defineTool } from '../src/index.js'
import { z } from 'zod'

const pingTool = defineTool({
  name: 'ping',
  description: 'Check if a host is reachable',
  inputSchema: z.object({ host: z.string() }),
  readOnly: true,
  destructive: false,
  concurrencySafe: true,
  maxResultSizeChars: 1_000,
  async execute(input, context) {
    return { output: `Pinging ${input.host} from ${context.workingDirectory}` }
  },
})

tools.register(pingTool)
```

---

## Examples

Runnable, focused demos — start here before looking at templates.

| Example | What it demonstrates |
|---|---|
| [`examples/minimal-agent`](./examples/minimal-agent) | The full loop with 3 tools, permissions, and memory. Nothing extra. |
| [`examples/coding-agent`](./examples/coding-agent) | File editing with tiered permission rules (allow reads, ask for writes) |
| [`examples/research-agent`](./examples/research-agent) | Search + synthesis + subagent delegation to format the final report |

---

## Templates

Production-quality starting points. Pick one, copy it out, make it yours.

| Template | What it demonstrates |
|---|---|
| [`templates/starter-agent`](./templates/starter-agent) | All 7 systems wired with minimal boilerplate — your blank slate |
| [`templates/researcher`](./templates/researcher) | Multi-step research, pluggable search provider (Tavily, Brave, Exa), subagent report formatting |
| [`templates/codebase-agent`](./templates/codebase-agent) | Project structure indexing, scoped path permissions per directory |
| [`templates/pipeline-agent`](./templates/pipeline-agent) | Non-interactive batch mode, CLI flags, CI/CD-friendly exit codes |
| [`templates/orchestrator`](./templates/orchestrator) | Task decomposition with 4 specialized subagent roles (researcher / coder / reviewer / writer) |

---

## Docs

One doc per system. Each one covers: what it is, why most agents get it wrong, the minimal viable version, and the production-grade version.

| Doc | System |
|---|---|
| [01-loop.md](./docs/01-loop.md) | The agent loop — iteration, events, termination |
| [02-tools.md](./docs/02-tools.md) | Tool contracts, safety metadata, path containment |
| [03-permissions.md](./docs/03-permissions.md) | Permission policies, priority rules, fail-closed defaults |
| [04-memory.md](./docs/04-memory.md) | 4-layer memory discovery, budget trimming, rendering |
| [05-subagents.md](./docs/05-subagents.md) | Context inheritance modes, depth limits, spawning patterns |
| [06-context.md](./docs/06-context.md) | Token budgeting, compaction strategies, result truncation |
| [07-prompts.md](./docs/07-prompts.md) | Layered prompt composition, cache stability, why order matters |

---

## How it's different

**The loop yields typed events, not logs.**

Every state transition — model request, tool call, permission denial, context compaction — is a typed `AgentEvent`. Consume what you care about, ignore the rest.

```typescript
{ type: 'model_request_start',  iteration: number }
{ type: 'model_response',       response: AssistantResponse }
{ type: 'tool_request',         toolUse: ToolUseBlock }
{ type: 'tool_result',          output: string; isError: boolean }
{ type: 'permission_denied',    toolName: string; reason: string; riskTier?: RiskTier }
{ type: 'context_near_limit',   tokenCount: number; limit: number }
{ type: 'context_compacted',    beforeTokens: number; afterTokens: number }
{ type: 'done',                 reason: TerminationReason }
// done reasons: 'end_turn' | 'max_iterations' | 'budget_exceeded' |
//               'repeated_tool_failure' | 'user_abort' | 'error'
```

Plug any logger into the `EventLogger` interface and receive every event with a `runId` for correlation:

```typescript
// Structured JSON to stderr — pipe into Datadog, Splunk, CloudWatch
const agent = createAgent({ ...config, logger: new ConsoleLogger() })

// NDJSON to a file or queue
const agent = createAgent({ ...config, logger: new NdJsonLogger(fs.createWriteStream('run.ndjson')) })

// Custom
class LangfuseLogger implements EventLogger {
  onEvent(runId: string, event: AgentEvent) {
    langfuse.trace({ id: runId, ...event })
  }
}
```

**Permissions are fail-closed, with live approval for `ask`-tier tools.**

Destructive tools (`file_write`, `shell_exec`) require explicit approval by default. No rule → no execution. Subagents can be given a more restrictive policy than the parent. Wire an `ApprovalHandler` to make `ask`-tier tools interactive:

```typescript
// Interactive y/N in the terminal
new CliApprovalHandler()

// Always approve — for CI pipelines where all tools are pre-trusted
new AutoApproveHandler()

// Custom — POST to Slack, a web UI, a queue
class SlackApprovalHandler implements ApprovalHandler {
  async approve(request, reason): Promise<'allow' | 'deny'> {
    await slack.post(`Approve ${request.tool}? Reason: ${reason}`)
    return waitForSlackResponse()
  }
}
```

**Cost guardrails built in.**

Set `tokenBudget` in `AgentConfig` and the loop hard-stops with `done: budget_exceeded` before costs run away. A circuit breaker halts with `done: repeated_tool_failure` if the same tool errors 3× in a row — preventing infinite retry spirals.

```typescript
const agent = createAgent({
  ...config,
  tokenBudget: 50_000,   // hard ceiling — ~$0.15 on gpt-4o
  maxIterations: 100,    // backstop safety valve
})
```

**Security containment on all file tools.**

`file_read`, `file_write`, and `grep` all resolve symlinks and verify the target is inside `workingDirectory` before executing. `shell_exec` is locked to `workingDirectory` — the model cannot override it.

**Subagents are context boundaries, not just workers.**

When spawning a subagent, you decide what context it gets: `none` (clean slate), `summary` (compressed parent history), or `full` (complete parent history). Depth is limited and enforced. Subagents can be cancelled and will time out.

**The model adapter is the only provider-specific code.**

Everything else talks to the `ModelAdapter` interface. OpenAI and Anthropic streaming adapters ship as reference implementations with retry logic and correct multi-turn tool call handling. Swap by passing a different adapter.

---

## Project Structure

```
based-agent/
├── src/
│   ├── index.ts                  # Public barrel — everything exports from here
│   ├── types.ts                  # Shared types: messages, events, responses
│   ├── core/
│   │   ├── loop.ts               # Agent loop + AgentConfig
│   │   ├── run-context.ts        # RunContext — UUID per run for log correlation
│   │   ├── model-adapter.ts      # AnthropicAdapter, OpenAIAdapter, createModelAdapter
│   │   └── errors.ts             # Typed error hierarchy
│   ├── tools/
│   │   ├── types.ts              # Tool interface + defineTool helper
│   │   ├── registry.ts           # ToolRegistry
│   │   └── built-in/
│   │       ├── file-read.ts      # readOnly, path containment
│   │       ├── file-write.ts     # destructive, path containment
│   │       ├── grep.ts           # readOnly, path containment, recursive
│   │       ├── shell-exec.ts     # destructive, timeout, abort signal
│   │       └── web-search.ts     # readOnly, pluggable provider
│   ├── permissions/
│   │   ├── policy.ts             # PermissionPolicy, allow/deny/ask rules
│   │   ├── rules.ts              # Default built-in rules
│   │   └── approval.ts          # ApprovalHandler — CliApprovalHandler, AutoApproveHandler
│   ├── telemetry/
│   │   └── types.ts              # EventLogger — ConsoleLogger, NdJsonLogger
│   ├── memory/
│   │   └── loader.ts             # 4-layer discovery, budget trimming
│   ├── context/
│   │   └── manager.ts            # ContextWindowManager, compaction strategies
│   ├── prompts/
│   │   └── builder.ts            # PromptBuilder, 6-layer composition
│   └── orchestration/
│       ├── subagent.ts           # Subagent, SubagentManager
│       └── types.ts              # SubagentParams, SubagentHandle
├── examples/
│   ├── minimal-agent/            # Simplest working agent
│   ├── coding-agent/             # File editing with permissions
│   └── research-agent/           # Search + delegation
├── templates/
│   ├── starter-agent/            # Blank slate
│   ├── researcher/               # Multi-step research
│   ├── codebase-agent/           # Scoped file access
│   ├── pipeline-agent/           # Batch / CI mode
│   ├── orchestrator/             # Multi-role subagent orchestration
│   └── verification-agent/       # Adversarial CI testing with structured exit codes
├── scripts/
│   └── test-enterprise.ts        # End-to-end integration tests (real API calls)
└── docs/                         # One doc per system (01-loop → 07-prompts)
```

---

## Why this exists

The model is not the problem. The model has been good for a while.

The problem is that most frameworks treat everything around the model as configuration — a few `maxTokens` here, a system prompt there. When the agent fails in production, there's nothing to debug because there was nothing designed.

This repo is the alternative. Each of the 7 systems is an explicit module with a typed interface, a documented rationale, a test suite, and a real implementation. The production infrastructure layer (telemetry, approval, cost guardrails, circuit breaking) is built on top of those same interfaces — not bolted on. Everything is independently replaceable. Nothing is magic.

---

## Testing

```bash
npm test                # Unit tests (78 tests, mocked model)
npm run test:enterprise # Integration tests (4 scenarios, real API calls)
```

The integration tests exercise: run identity (UUID correlation), EventLogger (structured JSON), ApprovalHandler (ask → approve flow), and token budget enforcement. They require a valid `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in `.env`.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The bar is simple: sharpen the spine, don't add complexity.
