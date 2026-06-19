import type { SDKMessage } from '../../types/sdk.js';
import type { ExecuteQueryOptions } from './types.js';
import { extractAssistantText } from './StreamHelpers.js';
import type { ManagedSession } from '../session/SDKSessionTypes.js';
import { getCachedQueryIterator } from '../session/SDKSessionInternals.js';
import { logger } from '../../utils/logger.js';

const DRAIN_SENTINEL = Symbol('drain-timeout');
const POST_RESULT_DRAIN_QUIET_MS = 1200;
const POST_RESULT_DRAIN_MAX_MS = 8000;
const POST_RESULT_DRAIN_POLL_MS = 250;

export async function drainPostResultMessages(params: {
  sessionId: string;
  managed: ManagedSession;
  options: ExecuteQueryOptions;
  responseChunks: string[];
  incrementIntermediateCount: () => void;
}): Promise<void> {
  const { sessionId, managed, options, responseChunks, incrementIntermediateCount } = params;
  const queryIter = getCachedQueryIterator(managed.session);
  const drainDeadline = Date.now() + POST_RESULT_DRAIN_MAX_MS;
  let quietDeadline = Date.now() + POST_RESULT_DRAIN_QUIET_MS;
  let drained = 0;
  const drainedTypes: string[] = [];
  let pending: Promise<IteratorResult<SDKMessage>> | undefined = queryIter?.next();

  while (queryIter && pending && Date.now() < drainDeadline) {
    const remaining = drainDeadline - Date.now();
    const timeoutMs = Math.max(1, Math.min(POST_RESULT_DRAIN_POLL_MS, quietDeadline - Date.now(), remaining));

    const raceResult = await Promise.race([
      pending,
      new Promise<typeof DRAIN_SENTINEL>(resolve =>
        setTimeout(() => resolve(DRAIN_SENTINEL), timeoutMs)
      ),
    ]);

    if (raceResult === DRAIN_SENTINEL) {
      if (Date.now() >= quietDeadline) {
        managed.pendingDrainPromise = pending;
        logger.debug(
          { sessionId, drained, drainedTypes },
          'Post-result drain: quiet window reached, carrying pending iterator promise'
        );
        pending = undefined;
        break;
      }
      continue;
    }

    const { done, value: drainMsg } = raceResult as IteratorResult<SDKMessage>;
    pending = undefined;
    if (done) break;

    drained++;
    const drainMsgType = (drainMsg as { type?: string })?.type ?? 'unknown';
    if (drainedTypes.length < 12) drainedTypes.push(drainMsgType);
    quietDeadline = Date.now() + POST_RESULT_DRAIN_QUIET_MS;

    const drainText = extractAssistantText(drainMsg);
    if (drainText.length > 0) {
      if (options.onIntermediateMessage) {
        await options.onIntermediateMessage(drainText);
        incrementIntermediateCount();
      } else {
        responseChunks.push(drainText);
      }
    }

    logger.debug(
      { sessionId, msgType: drainMsg.type, msgSubtype: 'subtype' in drainMsg ? (drainMsg as { subtype?: string }).subtype : undefined },
      'Post-result drain: consumed trailing message from queryIterator'
    );
    pending = queryIter.next();
  }

  if (pending && Date.now() >= drainDeadline) {
    managed.pendingDrainPromise = pending;
    logger.warn(
      { sessionId, drained, drainedTypes },
      'Post-result drain: max budget reached, carrying pending iterator promise'
    );
  } else if (drained > 0) {
    logger.info(
      { sessionId, drained, drainedTypes },
      'Post-result drain: consumed trailing messages'
    );
  }
}

interface DrainResult {
  drained: number;
  routed: number;
  drainedTypes: string[];
  pending?: Promise<IteratorResult<SDKMessage>>;
}

async function drainIterator(
  sessionId: string,
  managed: ManagedSession,
  opts: { perNextTimeoutMs: number; totalBudgetMs: number },
  initialPending?: Promise<IteratorResult<SDKMessage>> | null
): Promise<DrainResult> {
  const queryIter = getCachedQueryIterator(managed.session);
  if (!queryIter) return { drained: 0, routed: 0, drainedTypes: [] };

  const deadline = Date.now() + opts.totalBudgetMs;
  let drained = 0;
  const routed = 0;
  const drainedTypes: string[] = [];

  let pending: Promise<IteratorResult<SDKMessage>> | null = initialPending ?? queryIter.next();

  while (Date.now() < deadline) {
    const remaining = deadline - Date.now();
    const timeoutMs = Math.min(opts.perNextTimeoutMs, remaining);
    const TIMEOUT = Symbol('drain-iter-timeout');
    const raceResult = await Promise.race([
      pending,
      new Promise<typeof TIMEOUT>(resolve =>
        setTimeout(() => resolve(TIMEOUT), timeoutMs)
      ),
    ]);
    if (raceResult === TIMEOUT) return { drained, routed, drainedTypes, pending };
    if (raceResult.done) { pending = null; break; }
    drained++;
    const msgType = (raceResult.value as { type?: string })?.type ?? 'unknown';
    if (drainedTypes.length < 10) drainedTypes.push(msgType);

    if (Date.now() >= deadline) { pending = null; break; }
    pending = queryIter.next();
  }

  return pending
    ? { drained, routed, drainedTypes, pending }
    : { drained, routed, drainedTypes };
}

export async function preDrainResidualMessages(
  sessionId: string,
  managed: ManagedSession
): Promise<void> {
  if (managed.messageCount === 0) return;

  const initialPending = managed.pendingDrainPromise ?? undefined;
  managed.pendingDrainPromise = undefined;

  const { drained, drainedTypes, pending } = await drainIterator(
    sessionId, managed,
    { perNextTimeoutMs: 100, totalBudgetMs: 1000 },
    initialPending
  );
  managed.pendingDrainPromise = pending;

  if (drained > 0) {
    logger.warn(
      { sessionId, sessionMessageCount: managed.messageCount, drained, drainedTypes, pending: pending !== undefined },
      'Pre-drain: processed residual messages from previous query buffer'
    );
  } else if (pending !== undefined) {
    logger.debug(
      { sessionId, sessionMessageCount: managed.messageCount },
      'Pre-drain: no residual message yet, preserving pending iterator promise'
    );
  }
}
