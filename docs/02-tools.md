# 02 — Tools

Tools are how agents act. The problem isn't giving agents tools — it's giving them tools without contracts.

---

## What most agents do wrong

Raw function calling looks like this: you give the model a function signature and a description, the model calls it, you run it, you return the output. Done.

The problem: no metadata. No safety classification. No result size constraints. No input validation. No clear interface contract.

The result: tools get called with wrong inputs, return payloads too large to fit in context, execute destructive operations without warning, and fail in ways that produce confusing error states in the message history.

## What tools need

Every tool should declare:

| Field | Why |
|---|---|
| `name` | Unique identifier for routing |
| `description` | How the model decides when to use this tool |
| `inputSchema` | Typed, validated parameter contract (Zod) |
| `readOnly` | Whether the tool changes state |
| `destructive` | Whether the action is irreversible |
| `concurrencySafe` | Whether it's safe to run in parallel with other tools |
| `maxResultSizeChars` | Upper bound on output size before truncation |

These are not optional fields. They are the contract between the tool and the rest of the system.

## The tool interface

```typescript
interface Tool<TInput = unknown, TOutput = unknown> {
  // Identity
  name: string
  description: string
  inputSchema: ZodSchema<TInput>

  // Safety metadata
  readOnly: boolean
  destructive: boolean
  concurrencySafe: boolean
  maxResultSizeChars: number

  // Execution
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>

  // Optional
  validateInput?(input: TInput): ValidationResult
  formatResult?(output: TOutput): string
}
```

## Built-in tools

This repo ships five tools as reference implementations:

| Tool | readOnly | destructive | maxResultSize |
|---|---|---|---|
| `file_read` | true | false | 100,000 |
| `file_write` | false | true | 10,000 |
| `grep` | true | false | 50,000 |
| `shell_exec` | false | true | 50,000 |
| `web_search` | true | false | 20,000 |

`shell_exec` is the most dangerous: `readOnly: false`, `destructive: true`. The permission layer will require approval for it by default.

`web_search` ships as a mockable placeholder — plug in your preferred search API.

## Registering tools

```typescript
const registry = new ToolRegistry()
registry.register(new FileReadTool())
registry.register(new FileWriteTool())
registry.register(new GrepTool())

// Custom tool
registry.register({
  name: 'send_email',
  description: 'Send an email to a recipient',
  inputSchema: z.object({
    to: z.string().email(),
    subject: z.string(),
    body: z.string(),
  }),
  readOnly: false,
  destructive: true,   // Irreversible — mark it
  concurrencySafe: false,
  maxResultSizeChars: 1_000,
  async execute(input, ctx) {
    // ... your implementation
    return { output: 'Email sent' }
  },
})
```

## Result size enforcement

Every tool result passes through a size check. If the result exceeds `maxResultSizeChars`, the loop truncates it before injecting into context. The truncation strategy is controlled by the context manager (see [06 — Context](./06-context.md)).

Do not return large payloads and hope the model ignores them. It won't — it will try to process everything, degrading performance and burning tokens.

## Anti-patterns to avoid

**No metadata**: shipping tools as bare functions with no safety classification. The permission and context systems have nothing to work with.

**No input validation**: relying on the model to always provide well-formed inputs. It won't. Validate at the boundary with Zod — bad inputs should return clear error messages, not thrown exceptions that corrupt the message history.

**Unbounded results**: returning entire file contents, full grep outputs, complete API responses without size constraints. Always set `maxResultSizeChars`.

**Wrong concurrencySafe**: marking a tool as concurrency-safe when it isn't (e.g., it writes to a shared file). Parallel tool execution will produce race conditions.

**Shell injection**: `shell_exec` passes the model-generated command string directly to `sh -c`. If user input is interpolated into the task, a sufficiently creative prompt can cause the model to emit commands the user didn't intend. Always permission-gate `shell_exec`, and consider denying it entirely in automated pipelines (`nonInteractiveDefault: 'deny'`).
