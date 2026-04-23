/**
 * Documentation Guide role — targeted documentation updates.
 *
 * Use when code has changed and documentation needs to reflect it.
 * The agent reads what changed, reads what exists, and surgically updates —
 * it does not rewrite everything, it does not add marketing copy.
 *
 * Strictly scope-limited: only updates docs relevant to the stated change.
 */

import type { SubagentParams } from '../types.js'

export type DocumentationGuideParams = {
  /** What changed that requires documentation updates */
  task: string
  /** Files or modules that were changed */
  changedFiles?: string[]
  /** Docs to update (if known). If omitted, the agent discovers them. */
  targetDocs?: string[]
  inheritContext?: SubagentParams['inheritContext']
  parentMessages?: SubagentParams['parentMessages']
  timeout?: number
}

export function documentationGuide(params: DocumentationGuideParams): SubagentParams {
  const changedFilesBlock = params.changedFiles?.length
    ? `\nChanged files:\n${params.changedFiles.map(f => `  - ${f}`).join('\n')}`
    : ''

  const targetDocsBlock = params.targetDocs?.length
    ? `\nTarget documentation files:\n${params.targetDocs.map(f => `  - ${f}`).join('\n')}`
    : ''

  return {
    task: `
You are a documentation specialist. Your job is to update documentation so it accurately
reflects code that has already changed. You do not write new features — you make existing
docs correct.

Approach:
1. Read the changed code to understand what actually changed (behavior, API, configuration).
2. Find documentation that references the changed areas (README, inline docs, doc sites, CHANGELOG).
3. Make the minimum edit that makes the docs accurate. Do not rewrite sections that are still correct.
4. Add documentation for new behavior that has no coverage. Remove documentation for deleted behavior.

Quality bar:
- Docs should be accurate, not comprehensive. A correct one-liner beats an inaccurate paragraph.
- Use the same terminology the code uses — do not introduce synonyms.
- Do not add usage examples unless the current docs already have them and yours adds value.
- Do not add promotional or marketing language.

CRITICAL — Scope constraint:
Only update documentation that is directly affected by the stated change. Do not refactor
unrelated docs, fix unrelated typos, or reorganize sections that aren't broken.

What changed:
${params.task}${changedFilesBlock}${targetDocsBlock}

Output:
- List every documentation file you modified with a brief explanation of what changed and why.
- If you found documentation that is wrong but out of scope for this task, flag it separately
  rather than silently fixing it.
    `.trim(),
    inheritContext: params.inheritContext ?? 'none',
    ...(params.parentMessages !== undefined ? { parentMessages: params.parentMessages } : {}),
    ...(params.timeout !== undefined ? { timeout: params.timeout } : {}),
  }
}
