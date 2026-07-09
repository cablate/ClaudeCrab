import type { Options, McpSdkServerConfigWithInstance } from '../sdk/index.js';
import type { ToolEvent } from '../../types/message.js';
import type { ConversationRuntimeContext } from '../../types/runtimeContext.js';
import type { SubAgentEvent } from './SubAgentMessageManager.js';

export interface QueryUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
}

export interface QueryModelUsage extends QueryUsage {
  webSearchRequests?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
}

export interface QueryResult {
  response: string;
  sdkSessionId: string;
  numTurns?: number;
  durationMs?: number;
  intermediateMessageCount?: number;
  usage?: QueryUsage;
  totalCostUsd?: number;
  contextTokens?: number;
  actualModels?: string[];
  mainModel?: string;
  modelUsage?: Record<string, QueryModelUsage>;
}

export interface ExecuteQueryOptions {
  cwd: string;
  resume?: string | undefined;
  model?: string;
  maxTurns?: number;
  systemPrompt?: string;
  settingSources?: Array<'user' | 'project' | 'local'>;
  abortController?: AbortController;
  persistSession?: boolean;
  hooks?: Options['hooks'];
  additionalOptions?: Partial<Options>;
  runtimeContext?: ConversationRuntimeContext;
  onIntermediateMessage?: (text: string) => void | Promise<void>;
  onToolEvent?: (event: ToolEvent) => void | Promise<void>;
  onHookEvent?: (event: import('../../types/hookEvent.js').HookEvent) => void | Promise<void>;
  onSubAgentEvent?: (event: SubAgentEvent) => void | Promise<void>;
  subAgentManager?: import('./SubAgentMessageManager.js').SubAgentMessageManager;
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  allowedTools?: string[];
  requireResume?: boolean;
}
