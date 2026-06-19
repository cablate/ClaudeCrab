import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { AgentDefinition, PermissionMode } from '@anthropic-ai/claude-agent-sdk';
import type { Model } from '../../types/agent.js';
import { resolveFoundationDir } from '../agentPaths.js';

const MODEL_ALIASES = new Set(['sonnet', 'opus', 'haiku']);

export const FOUNDATION_SUBAGENTS_ROOT = path.join(
  resolveFoundationDir(),
  'subagents',
);

const PROMPTS_DIR = path.join(FOUNDATION_SUBAGENTS_ROOT, 'prompts');

export const FOUNDATION_SUBAGENTS_RUNTIME_CONFIG_PATH = path.join(
  FOUNDATION_SUBAGENTS_ROOT,
  'runtime-config.json',
);

type RuntimeOverrides = Record<string, Partial<AgentDefinition>>;

interface RuntimeOverridesFile {
  readonly subagents?: RuntimeOverrides;
}

interface ParsedPromptFile {
  name: string;
  fields: Record<string, string>;
  body: string;
}

function parseFrontmatter(content: string): ParsedPromptFile | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n*/);
  if (!match) return null;
  const frontmatter = match[1];
  if (frontmatter === undefined) return null;

  const fields: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }

  if (!fields['name'] || !fields['description']) return null;

  const body = content.slice(match[0].length).trimStart();
  return { name: fields['name'], fields, body };
}

function parseCommaSeparated(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  return value.split(',').map((t) => t.trim()).filter(Boolean);
}

function readRuntimeOverrides(): RuntimeOverrides {
  try {
    const file = JSON.parse(readFileSync(FOUNDATION_SUBAGENTS_RUNTIME_CONFIG_PATH, 'utf8')) as RuntimeOverridesFile;
    return file.subagents ?? {};
  } catch {
    return {};
  }
}

function resolveModel(
  model: string | undefined,
  modelResolver: (model: Model) => string,
): string | undefined {
  if (!model || model === 'inherit') return undefined;
  if (MODEL_ALIASES.has(model)) return modelResolver(model as Model);
  return model;
}

export function loadFoundationSubagents(
  modelResolver: (model: Model) => string,
): Record<string, AgentDefinition> {
  const overrides = readRuntimeOverrides();
  const result: Record<string, AgentDefinition> = {};

  const files = readdirSync(PROMPTS_DIR).filter((f) => f.endsWith('.md'));

  for (const file of files) {
    const content = readFileSync(path.join(PROMPTS_DIR, file), 'utf8');
    const parsed = parseFrontmatter(content);
    if (!parsed) continue;

    const { name, fields, body } = parsed;
    const ov = overrides[name];
    const description = ov?.description ?? fields['description'];
    if (description === undefined) continue;

    const def: AgentDefinition = {
      description,
      prompt: body,
    };

    // model
    const model = resolveModel(ov?.model ?? fields['model'], modelResolver);
    if (model !== undefined) def.model = model;

    // tools
    const tools = ov?.tools ?? parseCommaSeparated(fields['tools']);
    if (tools !== undefined) def.tools = [...tools];

    // disallowedTools
    const disallowedTools = ov?.disallowedTools ?? parseCommaSeparated(fields['disallowedTools']);
    if (disallowedTools !== undefined) def.disallowedTools = [...disallowedTools];

    // maxTurns
    const maxTurns = ov?.maxTurns ?? (fields['maxTurns'] ? Number(fields['maxTurns']) : undefined);
    if (maxTurns !== undefined) def.maxTurns = maxTurns;

    // effort
    const effort = ov?.effort ?? fields['effort'] as AgentDefinition['effort'] | undefined;
    if (effort !== undefined) def.effort = effort;

    // permissionMode
    const permissionMode = ov?.permissionMode ?? fields['permissionMode'] as PermissionMode | undefined;
    if (permissionMode !== undefined) def.permissionMode = permissionMode;

    // skills
    const skills = ov?.skills ?? parseCommaSeparated(fields['skills']);
    if (skills !== undefined) def.skills = [...skills];

    // memory
    const memory = (ov?.memory ?? fields['memory']) as AgentDefinition['memory'] | undefined;
    if (memory !== undefined) def.memory = memory;

    // background
    const background = ov?.background ?? (fields['background'] === 'true' ? true : undefined);
    if (background !== undefined) def.background = background;

    // initialPrompt
    const initialPrompt = ov?.initialPrompt ?? fields['initialPrompt'];
    if (initialPrompt !== undefined) def.initialPrompt = initialPrompt;

    result[name] = def;
  }

  return result;
}
