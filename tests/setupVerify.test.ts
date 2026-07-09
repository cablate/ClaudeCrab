import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getBundledCliCandidates,
  runClaudeCliCheck,
  runIsolatedBuildCheck,
  runTempDatabaseCheck,
} from '../scripts/setup-verify.ts';

const tempRoots: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claudecab-setup-verify-'));
  tempRoots.push(root);
  return root;
}

describe('setup-verify helpers', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('finds the SDK-bundled platform CLI package', async () => {
    const root = await createTempRoot();
    const [candidate] = getBundledCliCandidates(root);
    if (candidate === undefined) throw new Error('expected at least one bundled CLI candidate');
    await mkdir(path.dirname(candidate), { recursive: true });
    await writeFile(candidate, '', 'utf-8');

    const result = runClaudeCliCheck(root);

    expect(result.ok).toBe(true);
    expect(result.bundledCliPath).toBe(candidate);
    expect(result.messages.some((message) => message.includes('bundled CLI exists'))).toBe(true);
  });

  it('reports missing SDK-bundled platform CLI package as a setup failure', async () => {
    const root = await createTempRoot();

    const result = runClaudeCliCheck(root);

    expect(result.ok).toBe(false);
    expect(result.bundledCliPath).toBeUndefined();
    expect(result.messages.some((message) => message.includes('bundled CLI package not found'))).toBe(true);
  });

  it('initializes a disposable database and removes it afterwards', () => {
    const dbPath = runTempDatabaseCheck();

    expect(existsSync(dbPath)).toBe(false);
    expect(existsSync(path.dirname(dbPath))).toBe(false);
  });

  it('runs build verification without writing dist output', () => {
    runIsolatedBuildCheck(process.cwd());

    expect(existsSync(path.join(process.cwd(), '.tmp', 'build-check'))).toBe(false);
    expect(existsSync(path.join(process.cwd(), '.tmp', 'build-check.tsbuildinfo'))).toBe(false);
  }, 30_000);
});
