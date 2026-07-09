/**
 * StreamHelpers — Pure helper functions for SDK stream message processing.
 *
 * Extracted from SDKStreamProcessor.ts to reduce file size and isolate
 * testable pure logic from stream iteration.
 */

import type { SDKMessage } from '../../types/sdk.js';
import type { QueryModelUsage } from './types.js';

/** Extract text content from an assistant stream message. */
export function extractAssistantText(msg: SDKMessage): string {
  if (msg.type !== 'assistant' || !msg.message?.content) return '';
  const parts: string[] = [];
  for (const block of msg.message.content) {
    if (block.type === 'text') parts.push(block.text);
  }
  return parts.join('');
}

export function extractAssistantModel(msg: unknown): string | undefined {
  const message = msg as { type?: unknown; message?: { model?: unknown } };
  if (message.type !== 'assistant') return undefined;
  return typeof message.message?.model === 'string' && message.message.model.length > 0
    ? message.message.model
    : undefined;
}

/**
 * Extract the base tier name from a full Claude model identifier.
 * "claude-sonnet-4-20250514" → "sonnet"
 * "claude-3.5-haiku-v2" → "haiku"
 * Unknown / non-Claude models return the full string as-is.
 */
export function extractBaseModel(fullModel: string): string {
  const match = fullModel.match(/claude-(?:[\d.]+-)?(opus|sonnet|haiku)/);
  return match ? (match[1] ?? fullModel) : fullModel;
}

export function normalizeModelUsage(
  modelUsage: Record<string, {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    webSearchRequests?: number;
    costUSD?: number;
    contextWindow?: number;
    maxOutputTokens?: number;
  }>,
): Record<string, QueryModelUsage> {
  return Object.fromEntries(
    Object.entries(modelUsage).map(([model, usage]) => [
      model,
      {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
        costUsd: usage.costUSD ?? 0,
        ...(usage.webSearchRequests !== undefined ? { webSearchRequests: usage.webSearchRequests } : {}),
        ...(usage.contextWindow !== undefined ? { contextWindow: usage.contextWindow } : {}),
        ...(usage.maxOutputTokens !== undefined ? { maxOutputTokens: usage.maxOutputTokens } : {}),
      },
    ]),
  );
}

export function deltaModelUsage(
  current: Record<string, QueryModelUsage>,
  previous: Record<string, QueryModelUsage> | undefined,
): Record<string, QueryModelUsage> {
  const result: Record<string, QueryModelUsage> = {};
  for (const [model, usage] of Object.entries(current)) {
    const prev = previous?.[model];
    const delta: QueryModelUsage = {
      inputTokens: Math.max(0, usage.inputTokens - (prev?.inputTokens ?? 0)),
      outputTokens: Math.max(0, usage.outputTokens - (prev?.outputTokens ?? 0)),
      cacheReadInputTokens: Math.max(0, usage.cacheReadInputTokens - (prev?.cacheReadInputTokens ?? 0)),
      cacheCreationInputTokens: Math.max(0, usage.cacheCreationInputTokens - (prev?.cacheCreationInputTokens ?? 0)),
      costUsd: Math.max(0, usage.costUsd - (prev?.costUsd ?? 0)),
      ...(usage.webSearchRequests !== undefined
        ? { webSearchRequests: Math.max(0, usage.webSearchRequests - (prev?.webSearchRequests ?? 0)) }
        : {}),
      ...(usage.contextWindow !== undefined ? { contextWindow: usage.contextWindow } : {}),
      ...(usage.maxOutputTokens !== undefined ? { maxOutputTokens: usage.maxOutputTokens } : {}),
    };
    const used =
      delta.inputTokens > 0 ||
      delta.outputTokens > 0 ||
      delta.cacheReadInputTokens > 0 ||
      delta.cacheCreationInputTokens > 0 ||
      delta.costUsd > 0 ||
      (delta.webSearchRequests ?? 0) > 0;
    if (used) result[model] = delta;
  }
  return result;
}
