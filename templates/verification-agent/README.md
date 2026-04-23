# Verification Agent Template

A CI-friendly adversarial testing agent. Runs a `verificationSpecialist` subagent against
a described implementation and exits with:

- **`0`** — `VERDICT: PASS`
- **`1`** — `VERDICT: FAIL`
- **`2`** — `VERDICT: PARTIAL`

## Usage

```bash
# Interactive mode
npm run template:verify

# Non-interactive (CI/CD)
npm run template:verify -- \
  --task "Added JWT auth middleware to all /api routes" \
  --files src/middleware/auth.ts src/routes/api.ts
```

## What it tests

The verification specialist runs the actual build and test suite, executes adversarial
probes (boundary values, concurrency, idempotency), and refuses to issue PASS without
command output to back every claim.

See `src/orchestration/roles/verification-specialist.ts` for the full behavioral contract.
