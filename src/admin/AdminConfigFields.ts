export type FieldType = 'string' | 'number' | 'boolean' | 'permissionMode';

export interface FieldDefinition {
  key: string;
  label: string;
  type: FieldType;
  group: string;
  help: string;
  placeholder?: string;
  required?: boolean;
  secret?: boolean;
  restartRequired?: boolean;
}

export const GLOBAL_FIELDS: FieldDefinition[] = [
  {
    key: 'DISCORD_ENABLED',
    label: '啟用 Discord',
    type: 'boolean',
    group: 'Discord 入口',
    help: '一般 Discord bot 部署保持 true。只有本機檢查或暫停 Discord 入口時才改 false。',
    restartRequired: true,
  },
  {
    key: 'DISCORD_MAIN_BOT_TOKEN',
    label: '主 Bot Token',
    type: 'string',
    group: 'Discord 入口',
    help: '主 Bot 負責 slash command、系統訊息與維護操作；不要填 agent bot token。',
    placeholder: '留空表示保留既有 token',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'DISCORD_MAIN_BOT_CLIENT_ID',
    label: '主 Bot Application ID',
    type: 'string',
    group: 'Discord 入口',
    help: 'Discord Developer Portal 裡的 Application ID，用於註冊 slash command。',
    placeholder: '例如 123456789012345678',
    restartRequired: true,
  },
  {
    key: 'DISCORD_GUILD_ID',
    label: 'Discord Server ID',
    type: 'string',
    group: 'Discord 入口',
    help: 'ClaudeCab 會把 slash command 註冊到這個 Discord server。',
    placeholder: '例如 123456789012345678',
    restartRequired: true,
  },
  {
    key: 'DISCORD_OWNER_USER_ID',
    label: 'Operator Discord User ID',
    type: 'string',
    group: '權限與安全',
    help: '可使用重啟、關閉 session、同步、cache flush 等維護操作的 Discord 使用者。',
    placeholder: '你的 Discord numeric user ID',
    restartRequired: true,
  },
  {
    key: 'ALLOWED_USERS',
    label: '允許使用者白名單',
    type: 'string',
    group: '權限與安全',
    help: '選填。逗號分隔 Discord user ID；留空代表不限制一般對話使用者。',
    placeholder: '111111111111111111,222222222222222222',
    restartRequired: true,
  },
  {
    key: 'ADMIN_CONSOLE_TOKEN',
    label: '後台登入 Token',
    type: 'string',
    group: '權限與安全',
    help: '後台 API 的 bearer token。請使用長隨機字串，變更後需重啟才會生效。',
    placeholder: '留空表示保留既有 token',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'ANTHROPIC_API_KEY',
    label: '全域 Anthropic API Key',
    type: 'string',
    group: 'Claude / 模型服務',
    help: '選填。使用 Claude Code 訂閱 OAuth 時不要填；API key 部署才填。多 agent 或 proxy 建議改填 agent 專用設定。',
    placeholder: '留空表示保留既有 key',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'ANTHROPIC_BASE_URL',
    label: '全域 Provider Base URL',
    type: 'string',
    group: 'Claude / 模型服務',
    help: '選填。只有 Anthropic-compatible proxy 或第三方 provider 才需要；Claude Code OAuth 不要設定。',
    placeholder: 'https://your-provider-endpoint',
    restartRequired: true,
  },
  {
    key: 'SCHEDULE_ENABLED',
    label: '啟用排程',
    type: 'boolean',
    group: '排程',
    help: '控制 schedules 載入與執行。一般保持 true；完全不使用排程才改 false。',
    restartRequired: true,
  },
];

export const AGENT_FIELDS: FieldDefinition[] = [
  {
    key: 'name',
    label: '顯示名稱',
    type: 'string',
    group: '機器人基本設定（agent.json）',
    help: 'Discord 端顯示與辨識用名稱。',
    required: true,
  },
  {
    key: 'description',
    label: '描述',
    type: 'string',
    group: '機器人基本設定（agent.json）',
    help: '選填。給維運者辨識這個 agent 的用途，不會取代 agent 的 CLAUDE.md。',
  },
  {
    key: 'discordBotToken',
    label: 'Agent Bot Token',
    type: 'string',
    group: '機器人基本設定（agent.json）',
    help: '這個 agent 自己的 Discord bot token；不是主 Bot token。',
    placeholder: '留空表示保留既有 token',
    secret: true,
    restartRequired: true,
  },
  {
    key: 'discordChannelId',
    label: 'Agent 頻道 ID',
    type: 'string',
    group: '機器人基本設定（agent.json）',
    help: '這個 agent 監聽與回覆的 Discord channel ID。',
    placeholder: '例如 123456789012345678',
    restartRequired: true,
  },
];

export const AGENT_SETTINGS_FIELDS: FieldDefinition[] = [];

export const CLAUDE_SETTINGS_FIELDS: FieldDefinition[] = [
  {
    key: 'model',
    label: '實際執行模型',
    type: 'string',
    group: 'Claude Code / SDK 執行設定（.claude/settings.local.json）',
    help: '寫入 settings.local.json 的 model，會覆蓋 agent.json。可填 sonnet/opus/haiku，也可填 provider 實際模型 ID，例如 deepseek-v4-flash[1m]。既有對話可能要關閉 SDK session 或等新 session 才會使用。',
    placeholder: 'sonnet、opus、haiku 或 provider 模型 ID',
  },
];

export const PROVIDER_ENV_FIELDS: FieldDefinition[] = [
  {
    key: 'ANTHROPIC_API_KEY',
    label: '此 agent 的 API Key',
    type: 'string',
    group: '此 agent 專用模型服務（settings.local.json env）',
    help: '選填。要讓特定 agent 使用獨立 API key、DeepSeek、proxy 或其他 provider 時才填。',
    placeholder: '留空表示保留既有 key',
    secret: true,
  },
  {
    key: 'ANTHROPIC_AUTH_TOKEN',
    label: '此 agent 的 Auth Token',
    type: 'string',
    group: '此 agent 專用模型服務（settings.local.json env）',
    help: '少數 OAuth/token-compatible provider 才需要。一般 API key 模式請填上方 API Key，不要兩者都填。',
    placeholder: '留空表示保留既有 token',
    secret: true,
  },
  {
    key: 'ANTHROPIC_BASE_URL',
    label: '此 agent 的 Provider Base URL',
    type: 'string',
    group: '此 agent 專用模型服務（settings.local.json env）',
    help: '選填。DeepSeek、第三方 proxy、Anthropic-compatible endpoint 通常需要。Claude Code OAuth 不要填。',
    placeholder: 'https://your-provider-endpoint',
  },
  {
    key: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    label: 'Opus alias 對應模型',
    type: 'string',
    group: '模型 alias 對應（settings.local.json env）',
    help: '當 agent.json 或 schedule 填 opus 時，實際轉成這個 provider 模型。只有 provider 不認得 Claude alias 時才需要。',
    placeholder: '例如 deepseek-v4 或 claude-opus-4-1',
  },
  {
    key: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    label: 'Sonnet alias 對應模型',
    type: 'string',
    group: '模型 alias 對應（settings.local.json env）',
    help: '當 agent.json 或 schedule 填 sonnet 時，實際轉成這個 provider 模型。',
    placeholder: '例如 glm-5.2[1m]',
  },
  {
    key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    label: 'Haiku alias 對應模型',
    type: 'string',
    group: '模型 alias 對應（settings.local.json env）',
    help: '當 agent.json 或 schedule 填 haiku 時，實際轉成這個 provider 模型。',
    placeholder: '例如 deepseek-v4-flash',
  },
  {
    key: 'CLAUDE_CODE_SUBAGENT_MODEL',
    label: 'Sub-agent 模型',
    type: 'string',
    group: '模型 alias 對應（settings.local.json env）',
    help: 'Task/sub-agent 使用的模型。若派出去的 agent 成本或速度不合適，再調整這個值。',
    placeholder: '例如 deepseek-v4-flash[1m]',
  },
];

export const PERMISSION_MODE_VALUES = new Set(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk']);
