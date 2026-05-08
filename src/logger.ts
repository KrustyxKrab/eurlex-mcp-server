import pino from 'pino';

// Always log to stderr (fd 2):
// - In stdio MCP transport, stdout carries the protocol stream — logging there corrupts it
// - In HTTP mode, stderr is the conventional container log destination
const isDev = process.env.NODE_ENV !== 'production';

export const logger = isDev
  ? pino({
      name: 'eurlex-mcp',
      level: process.env.LOG_LEVEL ?? 'debug',
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, destination: 2, sync: true },
      },
    })
  : pino({ name: 'eurlex-mcp', level: process.env.LOG_LEVEL ?? 'info' }, pino.destination(2));
