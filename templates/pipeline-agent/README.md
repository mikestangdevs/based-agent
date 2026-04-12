# Pipeline Agent Template

A non-interactive batch processing agent designed for CI/CD pipelines and automated workflows.

## What this agent does

- Accepts a task via CLI flags (no interactive REPL)
- Reads input files, processes them, writes outputs
- Runs in non-interactive mode: `ask` → `deny`, no user prompts
- Writes only to a pre-approved output directory
- Returns structured exit codes for pipeline integration

## Setup

```bash
# 1. Add your API key
cp ../../.env.example ../../.env

# 2. Run a task directly
npm run template:pipeline -- --task "Summarize all markdown files in ./docs and write summaries to ./out"

# 3. Or process a directory of files
npm run template:pipeline -- --input ./data/raw --output ./data/processed

# 4. Dry run (no writes)
npm run template:pipeline -- --input ./data/raw --output ./data/processed --dry-run
```

## CLI flags

| Flag | Description |
|---|---|
| `--task` | Direct task string for the agent |
| `--input <dir>` | Input directory (batch mode) |
| `--output <dir>` | Output directory (batch mode, required with `--input`) |
| `--max-iterations` | Max loop iterations (default: 50) |
| `--dry-run` | Reads but no writes — safe for inspection |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Pipeline completed successfully |
| `1` | One or more errors (permission denied, file errors) |
| `2` | Pipeline hit max_iterations — may be incomplete |

## Customization checklist

- [ ] Edit the `## Processing instructions` section in `baseInstructions` for your specific task
- [ ] Add `--output` directory path to your CI/CD pipeline call
- [ ] Adjust `TOTAL_TIMEOUT_MS` for expected job duration
- [ ] Set `--max-iterations` based on how many files you're processing

## CI/CD integration example

```yaml
# .github/workflows/process-docs.yml
- name: Process documentation
  run: |
    npm run template:pipeline -- \
      --input ./docs/raw \
      --output ./docs/processed \
      --max-iterations 100
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Safety guarantees in non-interactive mode

- All destructive actions that aren't pre-approved are **denied automatically**
- Writes are only permitted to the explicitly configured output directory
- The agent logs every permission denial with a reason
- A hard timeout (10 minutes) prevents runaway jobs
