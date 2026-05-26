/**
 * Discord adapter interfaces for core -> adapter decoupling.
 * Core modules use these types instead of importing concrete adapter classes.
 */

import type { UnifiedMessage } from './message.js';

export interface AdapterSecurityConfig {
  allowedUsers: string[];
  whitelistEnabled: boolean;
  maxMessageLength: number;
  promptInjectionDetection: boolean;
}

export interface PlatformAdapter {
  readonly platform: 'discord';
  readonly agentId: string;
  onMessage(handler: (message: UnifiedMessage) => void | Promise<void>): void;
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export type DiscordAdapterFactory = (config: {
  platform: 'discord';
  agentId: string;
  agentsDir?: string;
  token: string;
  channelId: string;
  debug?: boolean;
  securityConfig?: AdapterSecurityConfig;
  sttProvider?: import('../core/stt/index.js').STTProvider;
}) => PlatformAdapter;
