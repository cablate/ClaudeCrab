# ClaudeCab

Multi-agent Telegram bot framework powered by Claude Agent SDK.

每個 agent 是一個獨立的 Claude Code 專案（「目錄即代理」），擁有自己的人格、記憶、技能。支援 WebUI 管理面板和 Live 虛擬辦公室即時監控。

## Features

- **Multi-Agent**: 每個 `agents/` 子目錄 = 一個獨立 agent，各有自己的 bot token
- **Live Office**: 虛擬辦公室即時監控頁面，顯示 agent 狀態、表情、對話
- **WebUI Admin**: 管理面板，查看對話、Agent 狀態、系統指標
- **Personality System**: 基於 mood/phase 的個性反應，agent 會自主發言、自言自語
- **Session Management**: 自動 session 管理、過期清理、SQLite 持久化
- **Security**: 使用者白名單、訊息驗證、Prompt injection 偵測
- **Schedule System**: Agent 排程任務，cron 驅動
- **Skill System**: Agent 可安裝 skills 擴充能力

## Quick Start

### Prerequisites

- Node.js >= 20.0.0
- Anthropic API Key
- Telegram Bot Token（從 [@BotFather](https://t.me/BotFather) 取得）

### 1. 安裝

```bash
git clone https://github.com/punkcanyang/ClaudeCab.git
cd claudecab
npm install
```

### 2. 快速設定（推薦）

```bash
npm run setup
```

互動式精靈會引導你設定 API Key、WebUI 密碼，並建立第一個 Agent。

<details>
<summary>或者手動設定</summary>

### 2a. 環境設定

```bash
cp .env.example .env
```

編輯 `.env`：

```env
# 必填
ANTHROPIC_API_KEY=sk-ant-xxxxx

# WebUI（如需管理面板或 Live 頁面）
WEBUI_ENABLED=true
WEBUI_PORT=3001
WEBUI_PASSWORD=your-secure-password        # 必填（WebUI 啟用時）
WEBUI_JWT_SECRET=your-random-secret-string  # 必填（WebUI 啟用時）
```

### 3. 設定 Agent

每個 agent 在 `agents/<id>/agent.json` 設定：

```json
{
  "name": "我的助手",
  "description": "一個通用助手",
  "model": "sonnet",
  "telegramBotToken": "123456:ABC-your-bot-token"
}
```

</details>

### 4. 啟動

```bash
# 開發模式（Hot Reload）
npm run dev

# 生產模式
npm run build && npm start
```

### 5. 驗證

- Telegram：對你的 bot 發送 `/start`
- WebUI：瀏覽 `http://localhost:3001`
- Live Office：瀏覽 `http://localhost:3001/live`（不需登入）

## Setup Checklist

| 步驟 | 說明 | 狀態 |
|------|------|------|
| `.env` 設定 `ANTHROPIC_API_KEY` | Anthropic API 金鑰 | 必填 |
| 建立至少一個 agent 目錄 | `agents/<id>/agent.json` + `CLAUDE.md` | 必填 |
| agent.json 設定 `telegramBotToken` | 從 @BotFather 取得 | 必填 |
| `.env` 設定 `WEBUI_PASSWORD` | WebUI 登入密碼 | WebUI 啟用時必填 |
| `.env` 設定 `WEBUI_JWT_SECRET` | JWT 簽章密鑰 | WebUI 啟用時必填 |
| `.env` 設定 `ALLOWED_USERS` | 限制可使用 bot 的 Telegram user ID | 建議設定 |

## Creating Agents

### 最小結構

```
agents/my-agent/
├── agent.json          # Agent 設定（名稱、模型、token）
└── CLAUDE.md           # System prompt
```

### 完整結構（含人格、記憶、技能）

```
agents/my-agent/
├── .claude/
│   └── settings.local.json   # Claude Code 權限設定
├── .claude/skills/            # Agent 技能
│   ├── persona/               # 人格定義（soul.md, identity.md）
│   └── sys-agent-protocols/   # 行為協議
├── agent.json
├── CLAUDE.md
├── memory/                    # 每日記憶
├── knowledge/                 # 知識庫
└── groups/                    # 群組討論紀錄
```

可複製 `agents/_example/` 作為模板。

### agent.json

```json
{
  "name": "助手名稱",
  "description": "助手描述",
  "version": "1.0.0",
  "model": "sonnet",
  "telegramBotToken": "your-bot-token",
  "display": {
    "avatar": "📝",
    "color": "#F59E0B",
    "sprite": "sprite.png",
    "portrait": "portrait.png",
    "emoji": {
      "neutral": "emoji-neutral.png",
      "excited": "emoji-excited.png",
      "annoyed": "emoji-annoyed.png",
      "tired": "emoji-tired.png",
      "focused": "emoji-focused.png",
      "bored": "emoji-bored.png"
    }
  }
}
```

| 欄位 | 說明 |
|------|------|
| `name` | 顯示名稱（必填） |
| `description` | Agent 描述 |
| `model` | `"sonnet"` / `"haiku"` / `"opus"` |
| `telegramBotToken` | Telegram Bot Token |
| `display.avatar` | Emoji 頭像（用於 fallback） |
| `display.color` | 主題色 |
| `display.sprite` | Live 頁面小人圖（相對於 `public/images/agents/<id>/`） |
| `display.portrait` | 立繪圖 |
| `display.emoji` | 表情反應圖（key 對應 mood） |

### Live 頁面圖片

圖片放在 `public/images/agents/<agent-id>/`。沒有圖片也能運行（fallback 為 emoji）。

圖片規格詳見 `.claude/skills/claudecab/references/product/image-asset-spec.md`。

驗證圖片是否符合規格：
```bash
node scripts/validate-image-assets.cjs
```

## Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | 開始對話 |
| `/help` | 顯示說明 |
| `/list` | 列出所有 agent |
| `/switch <agent>` | 切換 agent |
| `/reset` | 重置對話（需確認） |

## CLI Testing

不需要 Telegram 即可測試 agent：

```bash
npm run cli              # 測試預設 agent
npm run cli coder        # 測試指定 agent
```

## Environment Variables

| 變數 | 必填 | 預設 | 說明 |
|------|------|------|------|
| `ANTHROPIC_API_KEY` | ✅ | - | Anthropic API 金鑰 |
| `WEBUI_ENABLED` | - | `false` | 啟用 WebUI |
| `WEBUI_PORT` | - | `3001` | WebUI 端口 |
| `WEBUI_PASSWORD` | WebUI 時 | - | WebUI 登入密碼 |
| `WEBUI_JWT_SECRET` | WebUI 時 | - | JWT 簽章密鑰 |
| `ALLOWED_USERS` | - | (全部) | 允許的 Telegram user ID（逗號分隔） |
| `ENABLE_PERSISTENCE` | - | `false` | 啟用 SQLite 持久化 |
| `DB_PATH` | - | `./data/claudecab.db` | 資料庫路徑 |
| `LOG_LEVEL` | - | `info` | 日誌等級 |

## Troubleshooting

### Bot 沒有回應

1. 確認 `telegramBotToken` 在 agent.json 中設定正確
2. 確認 `ANTHROPIC_API_KEY` 有效
3. 檢查日誌：`npm run dev` 會顯示詳細日誌
4. 確認 bot 沒有被其他 instance 佔用（同一 token 只能一個 process 使用）

### WebUI 啟動失敗

1. 確認 `WEBUI_ENABLED=true`
2. 確認設定了 `WEBUI_PASSWORD` 和 `WEBUI_JWT_SECRET`
3. 確認端口沒被佔用

### Live 頁面看不到 Agent

1. 確認 agent 有設定 `telegramBotToken`（沒有 token 的 agent 不會啟動）
2. 確認 `ENABLE_PERSISTENCE=true`（Live 頁面需要持久化）

### Agent Sprite 顯示為 Emoji

正常行為 — 沒有圖片時 fallback 為 `display.avatar` emoji。
要顯示圖片，請在 `public/images/agents/<id>/` 放入圖片並設定 `display.sprite`。

## Development

```bash
npm run setup        # 互動式首次設定精靈
npm run dev          # 開發模式（Hot Reload）
npm run build        # 編譯 TypeScript
npm run typecheck    # 類型檢查
npm test             # 執行測試
npm run lint         # Linting
```

## Project Structure

```
claudecab/
├── src/
│   ├── adapters/        # Platform adapters (Telegram)
│   ├── core/            # AgentLoader, SessionManager, MessageProcessor
│   ├── persistence/     # SQLite repositories
│   ├── schedule/        # Cron schedule system
│   ├── webui/           # WebUI + Live page
│   └── types/           # TypeScript types
├── agents/              # Agent 目錄（每個子目錄 = 一個 agent）
├── public/              # 靜態資源（JS, CSS, images）
├── scripts/             # 工具腳本
└── data/                # SQLite 資料庫
```

## License

MIT
