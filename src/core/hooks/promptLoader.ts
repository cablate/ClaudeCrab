import path from 'node:path';
import { resolveFoundationDir } from '../agentPaths.js';

export function resolveHookPromptRoot(): string {
  return path.join(resolveFoundationDir(), 'hooks', 'prompts');
}
