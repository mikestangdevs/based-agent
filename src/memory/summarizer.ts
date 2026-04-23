/**
 * ConversationSummarizer — implements SummarizationHook for the context manager.
 *
 * This activates the 'summarize' and 'hybrid' compaction strategies in
 * ContextWindowManager, which otherwise silently fall back to sliding window.
 *
 * The summarizer calls the model with a carefully structured prompt that
 * produces a 9-section compressed context block, following the pattern from
 * production coding agent memory management:
 *
 *   1. Primary Request and Intent
 *   2. Key Technical Concepts
 *   3. Files and Code Sections
 *   4. Errors and Fixes
 *   5. Problem Solving
 *   6. All User Messages
 *   7. Pending Tasks
 *   8. Current Work
 *   9. Optional Next Step
 *
 * The model is called with NO tools — summarization is a pure text task.
 *
 * Usage:
 *   const summarizer = new ConversationSummarizer(modelAdapter)
 *   const context = new ContextWindowManager(
 *     { maxTokens: 200_000 },
 *     summarizer,  // <-- pass as the second argument
 *   )
 */

import type { Message } from '../types.js'
import type { SummarizationHook } from '../context/types.js'
import type { ModelAdapter } from '../core/index.js'

const SUMMARY_PROMPT = `
Produce a condensed summary of the conversation for seamless continuation.

CRITICAL: Reply with plain text only. Do NOT invoke any tools.
Output must contain exactly two blocks: <analysis> and <summary>.

In the <analysis> block, walk through the conversation chronologically:
- What the user asked for and their underlying intent
- The strategy or approach adopted
- Pivotal decisions and trade-offs made
- Technical concepts and patterns discussed
- Concrete details: file paths, code fragments, function signatures, file modifications
- Errors encountered and how they were resolved
- Any user feedback or corrections

In the <summary> block, include exactly these nine sections:
1. Primary Request and Intent — what the user originally wanted and the deeper goal
2. Key Technical Concepts — frameworks, patterns, algorithms, architectures involved
3. Files and Code Sections — every relevant file by path with complete code snippets where important
4. Errors and Fixes — every error that surfaced, how it was resolved, user reactions
5. Problem Solving — reasoning chains, alternative approaches considered, debugging strategies
6. All User Messages — list ALL non-tool-result messages from the user, preserving their substance
7. Pending Tasks — work that remains unfinished or was deferred
8. Current Work — precise description of what was actively being worked on at conversation end
9. Optional Next Step — must align directly with the user's most recent explicit requests

FINAL REMINDER: Do NOT invoke any tools. Respond exclusively with plain text.
`.trim()

export class ConversationSummarizer implements SummarizationHook {
  constructor(private readonly model: ModelAdapter) {}

  async summarize(messages: Message[]): Promise<string> {
    const parts: string[] = []

    // Collect the summary from the model — no tools, no streaming needed
    for await (const event of this.model.chat({
      messages,
      systemPrompt: SUMMARY_PROMPT,
      tools: [],      // No tools: summarization is pure text reasoning
      maxTokens: 4096,
    })) {
      if (event.type === 'message_complete') {
        for (const block of event.response.content) {
          if (block.type === 'text') {
            parts.push(block.text)
          }
        }
      }
    }

    const raw = parts.join('')

    // Extract the <summary> block if present, otherwise return the full text
    const summaryMatch = raw.match(/<summary>([\s\S]*?)<\/summary>/i)
    return summaryMatch ? summaryMatch[1]!.trim() : raw.trim()
  }
}
