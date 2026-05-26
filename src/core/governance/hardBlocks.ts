import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface HardBlockConfig {
  readonly enabled: boolean;
  readonly protectedWriteTools: readonly string[];
  readonly retiredPathMarkers: readonly string[];
  readonly outputRepoMarkerSegments: readonly string[];
  readonly messages: {
    readonly retiredPath: string;
    readonly outputRepoMarker: string;
  };
}

export interface HardBlockDecision {
  readonly ruleId: 'retired_path_write' | 'output_repo_marker';
  readonly reason: string;
  readonly target?: string;
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '../../..');
const outputPathPattern = /^agents\/(general|coder)\/output(?:\/|$)/;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeSlashes(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function normalizeWorkspacePath(rawPath: string, cwd: string): string {
  const cleaned = rawPath.trim();
  if (!cleaned) return '';

  try {
    const absolute = path.isAbsolute(cleaned)
      ? path.normalize(cleaned)
      : path.resolve(cwd, cleaned);
    const relative = path.relative(repoRoot, absolute).replace(/\\/g, '/');
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return normalizeSlashes(relative);
    }
  } catch {
    // Fall back to raw path normalization below.
  }

  return normalizeSlashes(cleaned);
}

function markerMatchesPath(normalizedPath: string, rawPath: string, marker: string): boolean {
  const normalizedMarker = normalizeSlashes(marker);
  const rawNormalized = normalizeSlashes(rawPath);
  const markerPrefix = normalizedMarker.endsWith('/') ? normalizedMarker : `${normalizedMarker}/`;

  return normalizedPath === normalizedMarker.replace(/\/$/, '') ||
    normalizedPath.startsWith(markerPrefix) ||
    rawNormalized === normalizedMarker.replace(/\/$/, '') ||
    rawNormalized.startsWith(markerPrefix);
}

function isOutputRepoMarkerPath(normalizedPath: string, markerSegments: readonly string[]): boolean {
  if (!outputPathPattern.test(normalizedPath)) return false;

  const markerSet = new Set(markerSegments);
  return normalizedPath.split('/').some((segment) => markerSet.has(segment));
}

function targetPathsForTool(toolName: string, toolInput: Record<string, unknown>): string[] {
  if (!['Write', 'Edit', 'MultiEdit'].includes(toolName)) return [];
  const pathValue = toolInput.file_path ?? toolInput.filePath;
  const target = asString(pathValue);
  return target ? [target] : [];
}

function isLikelyMutatingCommand(command: string): boolean {
  const trimmed = command.trim();
  return /^(mkdir|New-Item|Set-Content|Out-File|Remove-Item|rm|del|mv|Move-Item|cp|Copy-Item)\b/i.test(trimmed) ||
    /\b(git\s+init|npm\s+install|pnpm\s+install|yarn\s+install)\b/i.test(trimmed) ||
    />\s*\S+/.test(trimmed);
}

function commandMentionsOutputRepoMarker(command: string, markerSegments: readonly string[]): boolean {
  const normalized = normalizeSlashes(command);
  if (!/agents\/(general|coder)\/output\//.test(normalized) && !/\boutput\//.test(normalized)) {
    return false;
  }

  if (/\b(git\s+init|npm\s+install|pnpm\s+install|yarn\s+install)\b/i.test(command)) {
    return true;
  }

  return markerSegments.some((segment) => normalized.split(/[ \t;&|"'`]+/).some((part) => {
    const slashNormalized = normalizeSlashes(part);
    return slashNormalized.split('/').includes(segment);
  }));
}

export function evaluateHardBlockToolUse(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  cwd: string,
  config: HardBlockConfig,
): HardBlockDecision | undefined {
  if (!config.enabled || toolInput === undefined) return undefined;

  if (config.protectedWriteTools.includes(toolName)) {
    for (const rawTarget of targetPathsForTool(toolName, toolInput)) {
      const normalizedTarget = normalizeWorkspacePath(rawTarget, cwd);

      if (config.retiredPathMarkers.some((marker) => markerMatchesPath(normalizedTarget, rawTarget, marker))) {
        return {
          ruleId: 'retired_path_write',
          reason: `${config.messages.retiredPath}: ${normalizedTarget}`,
          target: normalizedTarget,
        };
      }

      if (isOutputRepoMarkerPath(normalizedTarget, config.outputRepoMarkerSegments)) {
        return {
          ruleId: 'output_repo_marker',
          reason: `${config.messages.outputRepoMarker}: ${normalizedTarget}`,
          target: normalizedTarget,
        };
      }
    }
  }

  if (toolName === 'Bash') {
    const command = asString(toolInput.command);
    if (!command || !isLikelyMutatingCommand(command)) return undefined;

    const normalizedCommand = normalizeSlashes(command);
    if (config.retiredPathMarkers.some((marker) => normalizedCommand.includes(normalizeSlashes(marker)))) {
      return {
        ruleId: 'retired_path_write',
        reason: config.messages.retiredPath,
      };
    }

    if (commandMentionsOutputRepoMarker(command, config.outputRepoMarkerSegments)) {
      return {
        ruleId: 'output_repo_marker',
        reason: config.messages.outputRepoMarker,
      };
    }
  }

  return undefined;
}
