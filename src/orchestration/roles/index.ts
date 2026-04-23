/**
 * Specialized subagent role prompts.
 *
 * Each role is a factory function that returns SubagentParams with a pre-built
 * behavioral contract for a specific type of work. Use these with SubagentManager.spawn().
 *
 * Example:
 *   const handle = subagents.spawn(codeExplorer({ task: 'Find all auth middleware' }))
 *   const result = await handle.wait()
 */

export { codeExplorer } from './code-explorer.js'
export { solutionArchitect } from './solution-architect.js'
export { verificationSpecialist } from './verification-specialist.js'
export { generalPurpose } from './general-purpose.js'
export { documentationGuide } from './documentation-guide.js'
