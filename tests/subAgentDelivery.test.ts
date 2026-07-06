import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BaseAdapter } from '../src/adapters/BaseAdapter.ts';
import type { SendOptions, SendResult } from '../src/types/message.ts';
import type { SDKMessage } from '../src/types/sdk.ts';
import { extractSubAgentEvent } from '../src/core/query/SubAgentEventParser.ts';
import { SubAgentMessageManager } from '../src/core/query/SubAgentMessageManager.ts';
import { createStreamState, deliverFinalResponse } from '../src/core/query/StreamResponseRouter.ts';

class FakeAdapter extends BaseAdapter {
  sent: Array<{ chatId: string; text: string; options?: SendOptions }> = [];
  edited: Array<{ chatId: string; messageId: string; text: string }> = [];

  async sendMessage(
    chatId: string,
    text: string,
    options?: SendOptions,
  ): Promise<SendResult> {
    this.sent.push({ chatId, text, options });
    return { success: true, messageId: `message-${this.sent.length}` };
  }

  override async editMessage(
    chatId: string,
    messageId: string,
    text: string,
  ): Promise<SendResult> {
    this.edited.push({ chatId, messageId, text });
    return { success: true, messageId };
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    // No-op for delivery tests.
  }

  protected async doInitialize(): Promise<void> {
    // No-op for delivery tests.
  }

  protected async doStart(): Promise<void> {
    // No-op for delivery tests.
  }

  protected async doStop(): Promise<void> {
    // No-op for delivery tests.
  }

  protected async doDispose(): Promise<void> {
    // No-op for delivery tests.
  }
}

const tempRoots: string[] = [];

async function tempFile(content: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'claudecab-subagent-'));
  tempRoots.push(root);
  const filePath = path.join(root, 'task-output.txt');
  await writeFile(filePath, content, 'utf-8');
  return filePath;
}

describe('sub-agent delivery', () => {
  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('extracts SDK task notifications into sub-agent events', () => {
    const message = {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-1',
      tool_use_id: 'tool-1',
      status: 'completed',
      summary: '研究完成',
      output_file: 'C:/tmp/task-output.txt',
    } as unknown as SDKMessage;

    expect(extractSubAgentEvent(message)).toEqual({
      toolUseId: 'tool-1',
      taskId: 'task-1',
      lifecycle: 'completed',
      summary: '研究完成',
      result: '研究完成',
      outputFile: 'C:/tmp/task-output.txt',
    });
  });

  it('edits the sub-agent message with completed output file content', async () => {
    const outputFile = await tempFile('這是派出去的 agent 完整結果');
    const adapter = new FakeAdapter({ platform: 'discord', agentId: 'general' });
    const manager = new SubAgentMessageManager(adapter, 'chat-1');

    await manager.handle({
      toolUseId: 'tool-1',
      lifecycle: 'started',
      summary: '開始研究 Threads 題材',
    });
    const delivered = await manager.handle({
      toolUseId: 'tool-1',
      lifecycle: 'completed',
      summary: '研究完成',
      outputFile,
    });

    expect(delivered).toBe(true);
    expect(adapter.sent[0]?.text).toContain('子代理 已開始');
    expect(adapter.edited[0]?.messageId).toBe('message-1');
    expect(adapter.edited[0]?.text).toContain('子代理 完成');
    expect(adapter.edited[0]?.text).toContain('這是派出去的 agent 完整結果');
    await expect(readFile(outputFile, 'utf-8')).resolves.toContain('完整結果');
  });

  it('does not emit silent-failure text when a sub-agent message was delivered', async () => {
    const adapter = new FakeAdapter({ platform: 'discord', agentId: 'general' });
    const state = createStreamState();
    state.subAgentMessageDelivered = true;

    await deliverFinalResponse(
      state,
      { response: '', numTurns: 1 },
      adapter,
      'chat-1',
      'general',
      'session-1',
    );

    expect(adapter.sent).toEqual([]);
  });
});
