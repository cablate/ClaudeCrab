import { hostname } from 'node:os';
import pino, { type LoggerOptions, type TransportTargetOptions } from 'pino';
import { logContext } from './logContext.js';

const level = process.env['LOG_LEVEL'] ?? 'info';
const isDev = process.env['NODE_ENV'] !== 'production';

/**
 * Instance fingerprint — identifies *this* running process uniquely.
 * Format: `<hostname>-<pid>-<startEpochBase36>` — short enough to eyeball,
 * unique enough that two instances running on the same box can never collide.
 *
 * Attached to every log line via pino `base`, so `grep instance_id logs/*.log`
 * reveals duplicate-instance scenarios immediately:
 *   grep instance_id logs/*.log | jq -r '.instance_id' | sort -u
 * If that returns >1 value for a single supervisor window, two bots are alive.
 */
export const INSTANCE_ID = `${hostname()}-${process.pid}-${Date.now().toString(36)}`;
export const INSTANCE_STARTED_AT = Date.now();

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

/**
 * Redact paths — prevent secrets from leaking into log files.
 * `remove: true` drops the field entirely rather than replacing with "[Redacted]".
 */
const redactPaths = [
  'token',
  '*.token',
  'apiKey',
  'api_key',
  '*.apiKey',
  '*.api_key',
  'password',
  '*.password',
  'authorization',
  '*.authorization',
  'DISCORD_BOT_TOKEN',
  'ANTHROPIC_API_KEY',
];

/**
 * Mixin runs for EVERY log line. We lift whatever's in AsyncLocalStorage
 * (correlation_id + any enriched fields) so log consumers can trace a
 * single operation by grepping one id, regardless of which module wrote
 * the line. Zero touch at call sites.
 */
const contextMixin = (): Record<string, unknown> => {
  const ctx = logContext.get();
  if (!ctx) return {};
  // Explicit spread — avoid leaking any accidentally-attached large objects.
  const out: Record<string, unknown> = { correlation_id: ctx.correlation_id };
  if (ctx.message_id !== undefined) out['message_id'] = ctx.message_id;
  if (ctx.platform !== undefined) out['platform'] = ctx.platform;
  if (ctx.agent_id !== undefined) out['agent_id'] = ctx.agent_id;
  if (ctx.user_id !== undefined) out['user_id'] = ctx.user_id;
  if (ctx.chat_id !== undefined) out['chat_id'] = ctx.chat_id;
  if (ctx.session_id !== undefined) out['session_id'] = ctx.session_id;
  if (ctx.parent_correlation_id !== undefined) out['parent_correlation_id'] = ctx.parent_correlation_id;
  return out;
};

const baseOptions: LoggerOptions = {
  level,
  base: {
    service: 'claudecab',
    instance_id: INSTANCE_ID,
  },
  mixin: contextMixin,
  serializers: {
    err: errorSerializer,
    error: errorSerializer,
  },
  redact: {
    paths: redactPaths,
    remove: true,
  },
};

const devOptions: LoggerOptions = {
  ...baseOptions,
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,instance_id',
      messageFormat: '{msg}',
      singleLine: false,
    },
  },
};

/**
 * Production: pino-roll rotated file only.
 * - Each restart gets its own base file: claudecab.{start-datetime}.log
 * - Within a long-running session: rolls at 10MB or daily, keep 30 files
 *
 * NO stdout target. Reason: on Windows, the supervisor captures start.ts's
 * stdout into supervisor-out.log, AND — despite start.ts spawning the child
 * with `stdio: ['ignore', 'ignore', 'pipe']` — child-process stdout still
 * leaks into that same file (Windows console-inheritance quirk). Writing pino
 * to stdout therefore cross-contaminated supervisor-out.log with 10k+
 * application JSON entries. Routing pino exclusively to the rotated file
 * keeps the two streams cleanly separated:
 *   - logs/claudecab.*.log    ← application JSON (pino)
 *   - logs/supervisor-out.log ← supervisor lifecycle messages only
 */
const startTs = new Date(INSTANCE_STARTED_AT).toISOString().slice(0, 19).replace(/:/g, '-');

const prodTargets: TransportTargetOptions[] = [
  {
    target: 'pino-roll',
    options: {
      file: `logs/claudecab.${startTs}.log`,
      frequency: 'daily',
      size: '10m',
      limit: { count: 30 },
      mkdir: true,
      dateFormat: 'yyyy-MM-dd',
    },
    level,
  },
];

const prodOptions: LoggerOptions = {
  ...baseOptions,
  transport: {
    targets: prodTargets,
  },
};

export const logger = pino(isDev ? devOptions : prodOptions);

export type Logger = pino.Logger;
