/**
 * Validator MCP tool.
 *
 * Gives runtime agents a deterministic way to run the ClaudeCab workspace
 * validator instead of guessing whether governance files are still valid.
 */

import { execFile } from 'node:child_process';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

export interface AgentWorkspaceValidationIssue {
  level: 'error' | 'warn';
  message: string;
  filePath: string;
}

export interface AgentWorkspaceValidationResult {
  schemaVersion: 1;
  validator: 'agent-workspace';
  scope: 'reference-trio';
  ok: boolean;
  counts: {
    errors: number;
    warnings: number;
  };
  issues: AgentWorkspaceValidationIssue[];
}

export interface RunAgentWorkspaceValidationOptions {
  repoRoot?: string;
  warnOnly?: boolean;
  timeoutMs?: number;
}

interface ExecCaptureResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function execFileCapture(
  command: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number },
): Promise<ExecCaptureResult> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error && !('code' in error)) {
        reject(error);
        return;
      }

      resolve({
        stdout,
        stderr,
        exitCode:
          error && typeof (error as { code?: unknown }).code === 'number'
            ? (error as { code: number }).code
            : 0,
      });
    });
  });
}

function parseValidatorJson(stdout: string, stderr: string): AgentWorkspaceValidationResult {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error(`Validator produced no JSON output. stderr=${stderr.trim()}`);
  }

  const parsed = JSON.parse(trimmed) as Partial<AgentWorkspaceValidationResult>;

  if (
    parsed.schemaVersion !== 1 ||
    parsed.validator !== 'agent-workspace' ||
    parsed.scope !== 'reference-trio' ||
    typeof parsed.ok !== 'boolean' ||
    !parsed.counts ||
    typeof parsed.counts.errors !== 'number' ||
    typeof parsed.counts.warnings !== 'number' ||
    !Array.isArray(parsed.issues)
  ) {
    throw new Error('Validator JSON does not match schema v1.');
  }

  return parsed as AgentWorkspaceValidationResult;
}

export async function runAgentWorkspaceValidation(
  options: RunAgentWorkspaceValidationOptions = {},
): Promise<AgentWorkspaceValidationResult> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const warnOnly = options.warnOnly ?? true;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const args = ['scripts/validate-agent-workspace.mjs', '--json'];
  if (warnOnly) args.push('--warn-only');

  const result = await execFileCapture(process.execPath, args, {
    cwd: repoRoot,
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  try {
    return parseValidatorJson(result.stdout, result.stderr);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        message,
        `exitCode=${result.exitCode ?? 'unknown'}`,
        `stdout=${result.stdout.slice(0, 1000)}`,
        `stderr=${result.stderr.slice(0, 1000)}`,
      ].join('\n'),
    );
  }
}

export function createValidatorMcpServer(repoRoot = process.cwd()) {
  return createSdkMcpServer({
    name: 'validator',
    version: '1.0.0',
    tools: [
      tool(
        'run_agent_workspace_validation',
        'Run the ClaudeCab reference-trio workspace validator. Use after editing workspace structure, foundation governance, hooks, skills, project READMEs, memory routing, output/uploads rules, or MCP/tool governance. Returns JSON schema v1.',
        {
          warnOnly: z
            .boolean()
            .optional()
            .default(true)
            .describe('When true, return validation JSON even if errors exist instead of treating validator errors as tool failure.'),
        },
        async (args: { warnOnly: boolean | undefined }) => {
          try {
            const validation = await runAgentWorkspaceValidation({
              repoRoot,
              warnOnly: args.warnOnly ?? true,
            });
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(validation, null, 2),
                },
              ],
            };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn({ error: message }, 'Validator MCP tool failed');
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: `Validator tool failed:\n${message}`,
                },
              ],
            };
          }
        },
      ),
    ],
  });
}

export function getValidatorToolNames(): string[] {
  return ['mcp__validator__run_agent_workspace_validation'];
}
