import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger.js';

const log = logger.child({ module: 'OAuthUsageService' });

export interface RateLimitWindow {
  utilization: number;
  resets_at?: string;
}

export interface OAuthUsageData {
  five_hour?: RateLimitWindow;
  seven_day?: RateLimitWindow;
}

const CACHE_TTL_MS = 60_000;
const CREDENTIALS_PATH = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.claude', '.credentials.json');

let cachedData: OAuthUsageData | null = null;
let cachedAt = 0;
let persistCallback: ((data: OAuthUsageData) => void) | undefined;

export function setOAuthUsagePersist(cb: (data: OAuthUsageData) => void): void {
  persistCallback = cb;
}

async function fetchUsage(token: string): Promise<OAuthUsageData | null> {
  try {
    const resp = await fetch('https://api.anthropic.com/api/oauth/usage', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      log.warn({ status: resp.status }, 'OAuth usage API returned non-OK');
      return null;
    }
    return await resp.json() as OAuthUsageData;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'OAuth usage API fetch failed');
    return null;
  }
}

function readOAuthToken(): string | null {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) return null;
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const creds = JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string; expiresAt?: number } };
    const oauth = creds.claudeAiOauth;
    if (!oauth?.accessToken) return null;
    if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
      log.debug('OAuth token expired');
      return null;
    }
    return oauth.accessToken;
  } catch {
    return null;
  }
}

export async function getOAuthUsage(): Promise<OAuthUsageData | null> {
  if (cachedData && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedData;
  }
  const token = readOAuthToken();
  if (!token) return cachedData;
  const data = await fetchUsage(token);
  if (data) {
    cachedData = data;
    cachedAt = Date.now();
    if (persistCallback) {
      try { persistCallback(data); } catch { /* ignore persist errors */ }
    }
  }
  return cachedData;
}
