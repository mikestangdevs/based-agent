# 03 — Permissions

Every tool call is a potential real-world action. Permissions are how you control which actions are allowed.

---

## Why action safety is mandatory

An agent without a permission layer is an agent where the model decides what it can do.

That is nearly always fine in demos. It is not a viable production posture. The model may:

- Execute shell commands that delete data
- Overwrite files that should be read-only
- Make network requests to unexpected endpoints
- Chain tool calls in ways that have compound destructive effects

The permission layer is the boundary between "the model decided to do X" and "X actually happened."

## The layered safety model

Permissions are evaluated in stack order. The first matching rule wins:

```
1. Explicit deny rules     — user/config-defined hard blocks
2. Explicit allow rules    — user/config-defined pre-approvals
3. Read-only tools         → allow automatically
4. Destructive tools       → ask (default) or deny (non-interactive mode)
5. Default                 → ask for anything not otherwise covered
```

This is fail-closed. Unknown situations require approval. Dangerous situations require explicit approval. Read-only situations are safe to allow.

## Policy configuration

```typescript
const policy = new PermissionPolicy()

// Block shell commands entirely
policy.deny({
  name: 'no-shell',
  match: (req) => req.tool === 'shell_exec',
  reason: 'Shell execution is disabled in this environment',
})

// Pre-approve file reads in the project directory
policy.allow({
  name: 'allow-project-reads',
  match: (req) => {
    const input = req.input as { path?: string }
    return req.tool === 'file_read' && (input.path?.startsWith('./') ?? false)
  },
  reason: 'Project file reads are pre-approved',
})

// Require approval for any file writes
// (This is the default behavior for non-readOnly tools — no config needed)
```

## Approval flows

When a tool call requires approval (`behavior: 'ask'`), the loop:

1. Yields a `permission_request` event with the tool, input, and reason
2. Waits for external resolution (user input, automated policy, timeout)
3. Continues if approved, injects an error result if denied

In non-interactive mode (background agents, pipelines), the default is `deny` instead of `ask`. You cannot prompt a user who isn't there.

```typescript
const policy = new PermissionPolicy({
  nonInteractiveDefault: 'deny',  // Fail-closed in automation
})
```

## Safe defaults

This repo ships with these defaults out of the box:

| Condition | Behavior |
|---|---|
| Tool is `readOnly: true` | Allow |
| Tool is `destructive: true` | Ask (interactive) / Deny (non-interactive) |
| Tool not in registry | Deny with error |
| Explicit deny rule matches | Deny |
| Explicit allow rule matches | Allow |
| No rule matches, not read-only | Ask |

No configuration required to get sensible safety behavior.

## Anti-patterns to avoid

**No permission layer**: relying on the model to "know" not to do dangerous things. It will do them eventually, because it thought the user wanted it to, or because it was confused about context.

**Allow-all configuration**: setting a global allow policy for convenience during development, then forgetting to remove it. Default to deny for destructive actions.

**Silent denial**: denying actions without giving the model a clear error message. The model needs to know *why* it can't do something so it can try an alternative approach.

**Permission prompts in batch jobs**: designing agents that require human approval but running them in automated pipelines. Set `nonInteractiveDefault: 'deny'` and pre-configure your allow rules.
