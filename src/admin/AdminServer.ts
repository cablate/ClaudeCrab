import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { AgentLoader } from '../core/orchestrator/AgentLoader.js';
import type { AppConfig } from '../config.js';
import { logger } from '../utils/logger.js';
import { AdminConfigService, type AdminAgentUpdate, type AdminGlobalUpdate } from './AdminConfigService.js';
import { runNpmCommand } from './AdminCommandRunner.js';
import { requestProcessRestart } from './AdminRestartService.js';
import { ADMIN_HTML } from './AdminHtml.js';

const log = logger.child({ module: 'AdminServer' });
const JSON_LIMIT_BYTES = 1_000_000;

export interface AdminServerOptions {
  config: AppConfig;
  agentLoader: AgentLoader;
  getBotStatus?: (agentId: string) => 'running' | 'stopped' | 'error' | 'no-token';
  cwd?: string;
}

export class AdminServer {
  private readonly config: AppConfig;
  private readonly agentLoader: AgentLoader;
  private readonly configService: AdminConfigService;
  private readonly getBotStatus: ((agentId: string) => 'running' | 'stopped' | 'error' | 'no-token') | undefined;
  private readonly cwd: string;
  private server: Server | null = null;

  constructor(options: AdminServerOptions) {
    this.config = options.config;
    this.agentLoader = options.agentLoader;
    this.getBotStatus = options.getBotStatus;
    this.cwd = options.cwd ?? process.cwd();
    this.configService = new AdminConfigService({
      cwd: this.cwd,
      agentsDir: this.config.agentsDir,
      localConfigPath: this.config.admin.localConfigPath,
    });
  }

  async start(): Promise<void> {
    if (!this.config.admin.enabled) return;
    if (this.server !== null) return;

    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => {
        log.error({ err: error }, 'Admin request failed');
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.config.admin.port, this.config.admin.host, () => {
        this.server?.off('error', reject);
        log.info(
          { host: this.config.admin.host, port: this.config.admin.port },
          'Admin console listening',
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (this.server === null) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    log.info('Admin console stopped');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin')) {
      sendHtml(res, ADMIN_HTML);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (!this.isAuthorized(req)) {
      sendJson(res, 401, { error: 'Unauthorized' });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const agents = this.agentLoader.list().map((agentId) => ({
        id: agentId,
        status: this.getBotStatus?.(agentId) ?? 'no-token',
      }));
      sendJson(res, 200, {
        ok: true,
        message: `Admin console active on ${this.config.admin.host}:${this.config.admin.port}`,
        agents,
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      sendJson(res, 200, await this.configService.getSnapshot());
      return;
    }

    if (req.method === 'PUT' && url.pathname === '/api/config/global') {
      const body = await readJsonBody<AdminGlobalUpdate>(req);
      sendJson(res, 200, await this.configService.updateGlobal(body));
      return;
    }

    const agentMatch = url.pathname.match(/^\/api\/agents\/([^/]+)$/);
    if (req.method === 'PUT' && agentMatch?.[1] !== undefined) {
      const agentId = decodeURIComponent(agentMatch[1]);
      const body = await readJsonBody<AdminAgentUpdate>(req);
      const result = await this.configService.updateAgent(agentId, body);
      await this.agentLoader.reloadAgent(agentId);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/validate') {
      const body = await readJsonBody<{ mode?: string; agent?: string }>(req);
      const mode = body.mode === 'verify' ? 'verify' : 'check';
      const args = mode === 'verify'
        ? ['run', 'setup:verify', ...(body.agent ? ['--', '--agent', body.agent] : [])]
        : ['run', 'setup:check', '--', ...(body.agent ? ['--agent', body.agent] : [])];
      const result = await runNpmCommand(args, {
        cwd: this.cwd,
        timeoutMs: mode === 'verify' ? 240_000 : 60_000,
      });
      sendJson(res, result.exitCode === 0 && !result.timedOut ? 200 : 500, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/restart') {
      const result = await requestProcessRestart({
        source: 'admin-console',
        cwd: this.cwd,
        buildCheckEnabled: this.config.admin.restartBuildCheckEnabled,
      });
      sendJson(res, result.ok ? 202 : 500, result);
      return;
    }

    sendJson(res, 404, { error: 'Not found' });
  }

  private isAuthorized(req: IncomingMessage): boolean {
    const expected = this.config.admin.token;
    if (expected === undefined || expected.length === 0) return false;
    const auth = req.headers.authorization;
    const bearer = auth?.startsWith('Bearer ') === true ? auth.slice('Bearer '.length) : undefined;
    const headerToken = Array.isArray(req.headers['x-admin-token'])
      ? req.headers['x-admin-token'][0]
      : req.headers['x-admin-token'];
    const actual = bearer ?? headerToken ?? '';
    return safeEqual(actual, expected);
  }
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > JSON_LIMIT_BYTES) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString('utf-8');
  if (text.trim() === '') return {} as T;
  return JSON.parse(text) as T;
}

function safeEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  res.end(html);
}
