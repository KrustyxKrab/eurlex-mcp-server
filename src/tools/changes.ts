import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { changesSchema } from '../schemas/changesSchema.js';
import { CellarClient } from '../services/cellarClient.js';
import type { RecentDocsResult } from '../types.js';
import { toolError } from '../utils.js';

export async function handleEurlexChanges(input: {
  since: string;
  resource_type: string;
  language: string;
  limit: number;
}): Promise<{ content: { type: 'text'; text: string }[]; isError?: true }> {
  try {
    const parsed = changesSchema.parse(input);
    const client = new CellarClient();

    const results = await client.recentDocuments({
      resource_type: parsed.resource_type,
      language: parsed.language,
      limit: parsed.limit,
      date_from: parsed.since,
    });

    if (results.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `No documents found published since ${parsed.since}`,
          },
        ],
      };
    }

    const output: RecentDocsResult = {
      since: parsed.since,
      results,
      total: results.length,
    };

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(output) }],
    };
  } catch (error) {
    return toolError(error);
  }
}

export function registerChangesTool(server: McpServer): void {
  server.tool(
    'eurlex_changes',
    'Returns EU legal documents published since a given date — useful for monitoring recent legislative activity',
    changesSchema.shape,
    { readOnlyHint: true, destructiveHint: false },
    async (params) => handleEurlexChanges(params),
  );
}
