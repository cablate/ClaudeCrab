import type { SDKMessage } from '../../types/sdk.js';
import type { SubAgentEvent, SubAgentLifecycle } from './SubAgentMessageManager.js';

type TaskSystemMessage = SDKMessage & {
  type: 'system';
  subtype?: unknown;
  task_id?: unknown;
  tool_use_id?: unknown;
  status?: unknown;
  description?: unknown;
  summary?: unknown;
  prompt?: unknown;
  output_file?: unknown;
  error?: unknown;
  patch?: unknown;
  uuid?: unknown;
  last_tool_name?: unknown;
};

const TASK_EVENT_SUBTYPES = new Set([
  'task_started',
  'task_progress',
  'task_notification',
  'task_updated',
  'task_completed',
  'task_failed',
]);

export function extractSubAgentEvent(message: SDKMessage): SubAgentEvent | null {
  if (message.type !== 'system' || !('subtype' in message)) return null;

  const systemMsg = message as TaskSystemMessage;
  const subtype = stringValue(systemMsg.subtype);
  if (subtype === undefined || !TASK_EVENT_SUBTYPES.has(subtype)) {
    return null;
  }

  const taskId = stringValue(systemMsg.task_id);
  const toolUseId =
    stringValue(systemMsg.tool_use_id) ??
    taskId ??
    stringValue(systemMsg.uuid) ??
    `task:${Date.now()}`;

  const patch = objectValue(systemMsg.patch);
  const lifecycle = taskLifecycle(systemMsg);
  const summary =
    stringValue(systemMsg.summary) ??
    stringValue(systemMsg.description) ??
    stringValue(patch?.description) ??
    stringValue(systemMsg.prompt) ??
    stringValue(systemMsg.last_tool_name);

  const event: SubAgentEvent = {
    toolUseId,
    lifecycle,
  };
  if (taskId !== undefined) event.taskId = taskId;
  if (summary !== undefined) event.summary = summary;

  const outputFile = stringValue(systemMsg.output_file);
  if (outputFile !== undefined) event.outputFile = outputFile;

  const error = stringValue(systemMsg.error);
  if (error !== undefined) event.error = error;

  if (subtype === 'task_notification' && lifecycle === 'completed') {
    const result = stringValue(systemMsg.summary);
    if (result !== undefined) event.result = result;
  }

  return event;
}

function taskLifecycle(message: TaskSystemMessage): SubAgentLifecycle {
  const subtype = stringValue(message.subtype);
  if (subtype === 'task_started') return 'started';
  if (subtype === 'task_progress') return 'progress';
  if (subtype === 'task_failed') return 'failed';
  if (subtype === 'task_completed') return 'completed';

  const patch = objectValue(message.patch);
  const status = stringValue(message.status) ?? stringValue(patch?.status);
  if (subtype === 'task_updated' && (status === undefined || status === 'pending' || status === 'running')) {
    return 'progress';
  }
  if (status === 'failed' || status === 'stopped' || status === 'killed') return 'failed';
  return 'completed';
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
