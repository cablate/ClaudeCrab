import { describe, expect, it } from 'vitest';
import { BaseAdapter } from '../src/adapters/BaseAdapter.ts';
import type { SendOptions, SendResult } from '../src/types/message.ts';
import { buildMcpSetup } from '../src/McpToolSetup.ts';

class FakeAdapter extends BaseAdapter {
  async sendMessage(
    _chatId: string,
    _text: string,
    _options?: SendOptions,
  ): Promise<SendResult> {
    return { success: true, messageId: 'message-id' };
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    // No-op for MCP setup tests.
  }

  protected async doInitialize(): Promise<void> {
    // No-op for MCP setup tests.
  }

  protected async doStart(): Promise<void> {
    // No-op for MCP setup tests.
  }

  protected async doStop(): Promise<void> {
    // No-op for MCP setup tests.
  }

  protected async doDispose(): Promise<void> {
    // No-op for MCP setup tests.
  }
}

describe('buildMcpSetup', () => {
  it('wires the built-in MCP servers and allowed tool names', () => {
    const adapter = new FakeAdapter({ platform: 'discord', agentId: 'coder' });

    const setup = buildMcpSetup(adapter, {
      agentId: 'coder',
      chatId: 'chat-id',
      userId: 'user-id',
      platform: 'discord',
    });

    expect(Object.keys(setup.mcpServers).sort()).toEqual(['file-send', 'validator']);
    expect(setup.allowedTools).toEqual([
      'send_file',
      'mcp__validator__run_agent_workspace_validation',
    ]);
  });
});
