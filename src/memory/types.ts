/**
 * Memory types — the contract between the memory loader and the rest of the system.
 */

// ---------------------------------------------------------------------------
// Memory layers (in priority order — higher = more specific)
// ---------------------------------------------------------------------------

export type MemoryLayer = 'task' | 'project' | 'workspace' | 'user'

// ---------------------------------------------------------------------------
// Memory file — a single loaded context document
// ---------------------------------------------------------------------------

export type MemoryFile = {
  /** Absolute path to the file on disk */
  path: string

  /** The raw file content */
  content: string

  /** Which semantic layer this file belongs to */
  layer: MemoryLayer

  /** Priority within the layer — higher = injected first */
  priority: number
}

// ---------------------------------------------------------------------------
// Memory context — the output of the loader
// ---------------------------------------------------------------------------

export interface MemoryContext {
  /** All loaded memory files */
  files: MemoryFile[]

  /** Total character count across all loaded files */
  totalChars: number

  /**
   * Render the memory context as a string for injection into a system prompt.
   * Empty files or zero-file contexts return an empty string.
   */
  render(): string
}

// ---------------------------------------------------------------------------
// Loader options
// ---------------------------------------------------------------------------

export type MemoryLoadOptions = {
  /** Root directory to start discovery from */
  rootDir: string

  /**
   * Filename to look for at each directory level.
   * Default: 'AGENT_CONTEXT.md'
   */
  contextFileName?: string

  /**
   * Walk subdirectories looking for nested context files.
   * Default: true
   */
  includeNested?: boolean

  /**
   * Optional path to a user-level global context file.
   * Example: '~/.based-agent/context.md'
   */
  userContextPath?: string

  /**
   * Optional task-specific context string (highest priority — injected first).
   */
  taskContext?: string

  /**
   * Maximum total characters to load across all layers.
   * Files are trimmed starting from lowest-priority layers.
   * Default: 50_000
   */
  maxTotalChars?: number
}
