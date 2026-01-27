import pino, { type LoggerOptions } from 'pino';

const level = process.env['LOG_LEVEL'] ?? 'info';
const isDev = process.env['NODE_ENV'] !== 'production';

/**
 * Custom error serializer to capture all error properties
 */
const errorSerializer = (err: unknown): Record<string, unknown> => {
  if (!(err instanceof Error)) {
    return { value: err };
  }

  const serialized: Record<string, unknown> = {
    type: err.name,
    message: err.message,
    stack: err.stack,
  };

  // Capture additional properties (like Anthropic API error details)
  for (const key of Object.keys(err)) {
    if (!(key in serialized)) {
      serialized[key] = (err as unknown as Record<string, unknown>)[key];
    }
  }

  // Handle cause property
  if ('cause' in err && err.cause !== undefined) {
    serialized.cause = errorSerializer(err.cause);
  }

  return serialized;
};

const baseOptions: LoggerOptions = {
  level,
  base: {
    service: 'claudecab',
  },
  serializers: {
    err: errorSerializer,
    error: errorSerializer,
  },
};

const devOptions: LoggerOptions = {
  ...baseOptions,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
      // Fix Chinese character display on Windows
      messageFormat: '{msg}',
      singleLine: false,
    },
  },
};

export const logger = pino(isDev ? devOptions : baseOptions);

export const createChildLogger = (
  context: Record<string, unknown>
): pino.Logger => {
  return logger.child(context);
};

export type Logger = pino.Logger;
