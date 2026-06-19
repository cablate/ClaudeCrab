import path from 'node:path';
import { resolveFoundationDir } from '../agentPaths.js';

export const HOOK_PROMPT_ROOT = path.join(resolveFoundationDir(), 'hooks', 'prompts');
