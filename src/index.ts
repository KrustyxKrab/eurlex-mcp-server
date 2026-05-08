#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { logger } from './logger.js';
import { createServer } from './server.js';

// Re-export so tests and tooling can import createServer from the entrypoint
export { createServer };

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('eurlex-mcp-server started (stdio transport)');
}

main().catch((error) => {
  logger.error({ error: String(error) }, 'Failed to start eurlex-mcp-server');
  process.exit(1);
});
