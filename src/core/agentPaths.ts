import path from 'node:path';

let configuredAgentsDir: string | undefined;

export function configureAgentPaths(agentsDir: string): void {
  configuredAgentsDir = path.resolve(agentsDir);
}

export function resolveAgentsDir(cwd: string = process.cwd()): string {
  return configuredAgentsDir ?? path.resolve(cwd, 'agents');
}

export function resolveFoundationDir(): string {
  return path.join(resolveAgentsDir(), '_foundation');
}
