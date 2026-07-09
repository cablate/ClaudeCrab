import type { SDKMessage } from '../../types/sdk.js';
import type { ManagedSession } from './SDKSessionTypes.js';

export function getCachedQueryIterator(session: ManagedSession['session']): AsyncIterator<SDKMessage> | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK doesn't expose queryIterator publicly.
  const iter = (session as any).queryIterator;
  return iter ?? null;
}

export function getSessionQuery(session: ManagedSession['session']): { interrupt(): Promise<void> } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK doesn't expose Query publicly.
  const query = (session as any).query;
  if (query && typeof query.interrupt === 'function') return query;
  return null;
}
