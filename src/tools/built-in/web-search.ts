/**
 * web_search — Search the web for information.
 * readOnly: true | destructive: false | concurrencySafe: true
 *
 * This is a mockable interface. In v1, you plug in your own search provider
 * by setting WEB_SEARCH_ENDPOINT or by subclassing and overriding `search()`.
 *
 * Works out of the box as a stub that returns a clear "not configured" message,
 * so the agent can tell the model what happened and suggest alternatives.
 */

import { z } from 'zod'
import type { Tool, ToolContext } from '../types.js'

const schema = z.object({
  query: z.string().describe('The search query'),
  maxResults: z.number().int().positive().max(20).optional().describe('Maximum number of results to return (default: 5)'),
})

export type WebSearchResult = {
  title: string
  url: string
  snippet: string
}

/**
 * Pluggable search provider interface.
 * Implement this and pass it to WebSearchTool to connect a real search API.
 */
export interface WebSearchProvider {
  search(query: string, maxResults: number): Promise<WebSearchResult[]>
}

/**
 * Stub provider — used when no real provider is configured.
 * Returns a clear message so the agent can degrade gracefully.
 */
class StubWebSearchProvider implements WebSearchProvider {
  async search(query: string): Promise<WebSearchResult[]> {
    return [
      {
        title: 'Web search not configured',
        url: '',
        snippet: `Web search is not configured. To enable it, implement the WebSearchProvider interface and pass it to WebSearchTool. Query was: "${query}"`,
      },
    ]
  }
}

export class WebSearchTool implements Tool<typeof schema> {
  readonly name = 'web_search'
  readonly description = `Search the web for current information. Returns titles, URLs, and snippets. Use for finding documentation, recent events, or information not in your training data.`
  readonly inputSchema = schema
  readonly readOnly = true
  readonly destructive = false
  readonly concurrencySafe = true
  readonly maxResultSizeChars = 20_000

  private readonly provider: WebSearchProvider

  constructor(provider?: WebSearchProvider) {
    this.provider = provider ?? new StubWebSearchProvider()
  }

  async execute(input: z.infer<typeof schema>, _context: ToolContext) {
    const maxResults = input.maxResults ?? 5
    const results = await this.provider.search(input.query, maxResults)

    const formatted = results
      .map((r, i) => [
        `${i + 1}. **${r.title}**`,
        r.url ? `   URL: ${r.url}` : '',
        `   ${r.snippet}`,
      ].filter(Boolean).join('\n'))
      .join('\n\n')

    return { output: formatted || 'No results found.' }
  }
}
