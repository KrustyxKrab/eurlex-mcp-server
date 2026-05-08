import { randomUUID } from 'node:crypto';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import rateLimit from 'express-rate-limit';

import { SESSION_TTL_MS } from './constants.js';
import { logger } from './logger.js';
import { createServer } from './server.js';

const SERVER_START = Date.now();

// Rate limiting: each MCP request triggers upstream EUR-Lex API calls
export const mcpLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => (req.headers['mcp-session-id'] as string) || req.ip || 'unknown',
  message: { error: 'Too many requests. Please try again later.' },
  validate: { keyGeneratorIpFallback: false },
});

function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  const reqId = (req.headers['x-request-id'] as string) ?? randomUUID().slice(0, 8);
  res.setHeader('x-request-id', reqId);

  res.on('finish', () => {
    logger.info(
      {
        req_id: reqId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: Date.now() - start,
        session_id: req.headers['mcp-session-id'] ?? undefined,
      },
      'request',
    );
  });

  next();
}

export function createApp(): {
  app: express.Express;
  transports: Map<string, StreamableHTTPServerTransport>;
  lastSeen: Map<string, number>;
} {
  const app = express();
  app.use(express.json());
  app.use(requestLogger);
  app.use('/mcp', mcpLimiter);

  const transports = new Map<string, StreamableHTTPServerTransport>();
  const lastSeen = new Map<string, number>();

  // Sweep stale sessions (unref'd so it doesn't prevent exit)
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [sid, ts] of lastSeen) {
      if (now - ts > SESSION_TTL_MS) {
        const t = transports.get(sid);
        if (t) {
          t.close?.();
          transports.delete(sid);
        }
        lastSeen.delete(sid);
        logger.debug({ session_id: sid }, 'session swept (TTL expired)');
      }
    }
  }, 60_000);
  sweep.unref();

  // Health check
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      service: 'eurlex-mcp-server',
      version: '1.0.0',
      uptime_s: Math.floor((Date.now() - SERVER_START) / 1000),
      node_version: process.version,
      active_sessions: transports.size,
    });
  });

  // POST /mcp — create or reuse session
  app.post('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId);
      if (!transport) return;
      lastSeen.set(sessionId, Date.now());
      await transport.handleRequest(req, res, req.body);
      return;
    }

    if (!isInitializeRequest(req.body)) {
      res.status(400).json({ error: 'First request must be an initialize request' });
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: (): string => randomUUID(),
      onsessioninitialized: (sid: string): void => {
        transports.set(sid, transport);
        lastSeen.set(sid, Date.now());
        logger.info({ session_id: sid }, 'session initialized');
      },
    });

    transport.onclose = (): void => {
      const sid = transport.sessionId;
      if (sid) {
        transports.delete(sid);
        lastSeen.delete(sid);
        logger.info({ session_id: sid }, 'session closed');
      }
    };

    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE on existing session
  app.get('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) return;
    await transport.handleRequest(req, res);
  });

  // DELETE /mcp — session cleanup
  app.delete('/mcp', async (req: Request, res: Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports.has(sessionId)) {
      res.status(400).json({ error: 'Invalid or missing session ID' });
      return;
    }
    const transport = transports.get(sessionId);
    if (!transport) return;
    await transport.handleRequest(req, res);
  });

  return { app, transports, lastSeen };
}

// ---------------------------------------------------------------------------
// Auto-start (guarded — does not run during tests)
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  const { app, transports } = createApp();
  const PORT = Number(process.env.PORT ?? 3001);

  const httpServer = app.listen(PORT, () => {
    logger.info({ port: PORT }, 'eurlex-mcp-server HTTP transport listening');
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'shutdown initiated');
    httpServer.close(() => {
      for (const [sid, transport] of transports) {
        transport.close?.();
        transports.delete(sid);
      }
      logger.info('server closed gracefully');
      process.exit(0);
    });
    // Force-exit after 30 s if graceful close stalls
    setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 30_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
