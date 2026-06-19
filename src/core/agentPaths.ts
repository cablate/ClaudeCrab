import path from 'node:path';

export function resolveAgentsDir(): string {
  const configured = process.env.AGENTS_DIR?.trim();
  return configured ? path.resolve(configured) : path.resolve(process.cwd(), 'agents');
}

export function resolveFoundationDir(): string {
  return path.join(resolveAgentsDir(), '_foundation');
}
