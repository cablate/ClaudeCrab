# ClaudeCab 功能分析報告

**日期**：2026-02-21  
**狀態**：分析完成，待決定實作優先順序

---

## 1. TG Command 重啟伺服器（`/restart`）✅ 已完成

### 需求
在 Telegram 新增指令，讓使用者可以在改完程式碼後直接重啟 ClaudeCab 伺服器。

### 狀態
✅ **已完成** — 2026-02-23

**實作內容：**
- PM2 整合（`ecosystem.config.cjs`）
- `/restart` 指令（限 `ALLOWED_USERS`）
- TypeScript 檢查（`tsc --noEmit`）— 檢查失敗則取消重啟

### 現有架構
- `TelegramCommands.ts` 已有完整的指令系統
- `CommandDependencies` interface 定義了指令所需的依賴

### 技術挑戰

| 挑戰 | 說明 | 解法 |
|------|------|------|
| 進程自殺問題 | `process.exit()` 後，誰來重啟？ | 需要外部 process manager（PM2 / systemd） |
| Graceful shutdown | 正在處理的訊息會中斷 | 需要等待 in-flight 請求完成 |
| 權限控制 | 不能讓任何人都能重啟 | 比對 userId，只允許特定 Telegram ID |

### 建議實作方式

**方案 A：PM2 模式（推薦）**
```
/restart → 發送確認訊息 → process.exit(0) → PM2 自動重啟
```

**方案 B：自帶重啟邏輯（較複雜）**
```
/restart → spawn 新進程 → 優雅關閉舊進程
```

### 實作步驟
1. 在 `TelegramCommands.ts` 新增 `handleRestart` 函式
2. 在 `COMMAND_HANDLERS` 註冊 `/restart`
3. 設定允許使用者白名單（環境變數或設定檔）
4. 確保使用 PM2 或類似工具運行

---

## 2. 跨 Agent 主動通訊機制

### 需求
讓員工（Agent A）可以主動通知主管（Agent B），而非由使用者手動轉達。

### 情境範例
```
Coder 完成任務
    ↓
Coder 呼叫 notifyAgent("admin", "我更新了 method-code-review skill，請審閱")
    ↓
訊息存入 admin 的「待處理佇列」
    ↓
下次 admin session 啟動時，systemPrompt 或 hook 注入這些通知
```

### 可行性
✅ **可行，實作難度中**

### 現有架構
- `GroupBroadcaster` 處理群組訊息路由
- `DelegationHandler` 處理 agent 委派（使用者發起）
- 目前沒有「agent 主動通知 agent」的機制

### 可能的實作方向

| 方向 | 機制 | 優缺點 |
|------|------|--------|
| **A. 檔案佇列** | 寫入 `agents/{targetAgent}/inbox/{timestamp}.md` | 簡單，符合 Agent 自主管理哲學 |
| **B. DB 佇列** | 新增 `notifications` table | 結構化，但需改 DB schema |
| **C. Custom Tool** | 提供 `notifyAgent` MCP tool | agent 可程式化呼叫 |

### 建議方向
**方向 A（檔案佇列）** 最符合 ClaudeCab 的設計哲學：
- 引擎層只負責存檔到目標 agent 的 inbox
- Agent 透過 CLAUDE.md 指令自己讀取 inbox
- 保持 agent 自主性，不需要引擎層理解訊息內容

### 實作步驟
1. 定義 inbox 格式（markdown 或 JSON）
2. 新增 `notifyAgent` custom tool
3. 在 agent 的 startup protocol 加入「檢查 inbox」步驟
4. 設計已讀追蹤機制（刪除或移動到 archive）

---

## 3. AstrBot 與 MaiBot 分析

### AstrBot

**簡介**：開源的 Agentic IM Chatbot 基礎架構，主打多平台整合。

| 項目 | 內容 |
|------|------|
| 技術棧 | Python 3.10+, Docker, WebUI |
| 平台支援 | QQ, Telegram, WeChat, Feishu, DingTalk, Slack, Discord, LINE 等 |
| AI 整合 | OpenAI, Anthropic, Gemini, DeepSeek, Ollama 等 |
| 核心賣點 | ~800 個社群 plugin、一鍵部署、Agent Sandbox |

**對 ClaudeCab 的參考價值**：

| 可借鏡 | 說明 |
|--------|------|
| Plugin 市集 | ClaudeCab 的 Skill 系統可以考慮「可分享 skill 套件」的概念 |
| 多平台適配器 | AstrBot 的 adapter 抽象設計成熟，但 ClaudeCab 的 BaseAdapter 已夠用 |
| i18n | 如果 ClaudeCab 未來要公開發布可參考 |

**不需要抄的**：
- AstrBot 是 Python，架構哲學不同
- 它是「萬用 chatbot 框架」，ClaudeCab 是「multi-agent 協作系統」，定位不同

**Source**: [AstrBot GitHub](https://github.com/AstrBotDevs/AstrBot)

---

### MaiBot（麥麥）

**簡介**：專注於「擬人化群聊」的 QQ Bot，追求「像真人」而非「功能完善」。

| 項目 | 內容 |
|------|------|
| 技術棧 | Python 3.10+, Docker, Web UI (React 19) |
| 核心理念 | 「最像而不是好」— 會犯錯、有自主性的生命形式 |
| 特色功能 | 情緒系統、表達學習、主動發言、多重人格切換 |

**對 ClaudeCab 的參考價值**：

| 可借鏡 | 說明 |
|--------|------|
| 情緒系統 | ClaudeCab 的 `ActivityMood` 已有類似概念，可考慮讓 mood 影響回覆風格 |
| 表達學習 | Agent 可透過 MEMORY.md 累積「使用者偏好的表達方式」 |
| 主動發言時機 | ClaudeCab 的 `InitiativeHandler` 已有主動互動，可參考 MaiBot 的「提出問題」模式 |
| 擬人化哲學 | 「會犯錯的生命形式」這個設計理念與 ClaudeCab 的 persona skill 概念相符 |

**不需要抄的**：
- MaiBot 專注 QQ，ClaudeCab 已有 Telegram 適配
- 它的記憶系統細節未公開，ClaudeCab 的「Agent 自主管理記憶」設計已經很成熟

**Source**: [MaiBot GitHub](https://github.com/MaiM-with-u/MaiBot)

---

## 4. Telegram Markdown 表格問題

### 問題
Telegram 不支援 Markdown 表格語法，`| --- |` 會原樣顯示，難以閱讀。

### 現有架構
ClaudeCab 已有 `src/utils/telegramMarkdown.ts`：
- 使用 `telegramify-markdown` 轉換基本 Markdown
- 有 MarkdownV2 → Markdown → 純文字的 fallback 機制
- 但不處理表格

### 可用方案

| 方案 | 做法 | 優點 | 缺點 |
|------|------|------|------|
| A. 等寬文字 | 用 `<pre>` + 手動對齊 | 簡單、原生支援 | 中文對齊困難 |
| B. 轉成圖片 | matplotlib/canvas 生成表格圖 | 視覺效果好 | 需要額外處理 |
| C. 轉成列表 | `• 項目: 值` 格式 | 最簡單 | 不適合多欄資料 |
| D. 智能轉換 | 偵測表格語法，自動轉成其他格式 | 使用者無感 | 需要實作邏輯 |

### 建議方向
**方案 D（智能轉換）** 最符合 ClaudeCab 的設計：
- 在 `telegramifyMarkdown` 後加一層表格偵測
- 自動轉成等寬文字或列表格式
- Agent 不需要改變輸出習慣

### 實作步驟
1. 新增 `convertTableToTelegramFormat()` 函式
2. 在 `sendWithMarkdownFallback()` 中先處理表格
3. 根據表格複雜度選擇輸出格式（簡單→列表，複雜→等寬）

---

## 5. Schedule 模型設定 ⏳ 待實作

### 需求
讓 schedule YAML 可以指定執行時使用的模型（opus/sonnet/haiku），而非只能用 agent 預設模型。

### 使用場景
- 每日摘要用 Haiku（省成本）
- 重要分析用 Opus（高品質）
- 一般任務用 Sonnet（平衡）

### 可行性
✅ **可行，實作難度低**

### 現況
- `ScheduleSpec.execution` 只有 `agent`, `prompt`, `maxTurns`, `timeout`
- **沒有 `model` 欄位**
- 執行時使用 agent 的預設模型

### 需要修改

| 檔案 | 修改內容 |
|------|----------|
| `src/schedule/schemas.ts` | `ExecutionSchema` 加入 `model?: 'sonnet' \| 'opus' \| 'haiku'` |
| `src/schedule/ScheduleExecutor.ts` | 執行時如果 `spec.execution.model` 存在，傳給 SDK |
| `src/core/SDKQueryManager.ts` | `ExecuteQueryOptions` 加入 `model` 並傳給 SDK |

### YAML 範例

```yaml
id: daily-summary
name: 每日摘要
description: 使用 Haiku 生成低成本摘要

trigger:
  type: cron
  cron: "0 9 * * *"
  timezone: Asia/Taipei

execution:
  agent: secretary
  prompt: 請生成今日待辦摘要
  model: haiku           # ← 新增：覆蓋 agent 預設模型
  maxTurns: 5
  timeout: 60000

notification:
  onComplete: true
  chatId: "123456789"

metadata:
  createdAt: "2026-02-21T00:00:00+08:00"
  createdBy: system
  enabled: true
```

### 實作步驟

1. **修改 Schema**（`schemas.ts`）：
   ```typescript
   export const ExecutionSchema = z.object({
     agent: z.string(),
     prompt: z.string(),
     model: z.enum(['sonnet', 'opus', 'haiku']).optional(),  // 新增
     maxTurns: z.number().positive().optional(),
     timeout: z.number().positive().optional(),
   });
   ```

2. **修改 Executor**（`ScheduleExecutor.ts`）：
   - 讀取 `spec.execution.model`
   - 如果存在，用 `ConfigTransformer.getSDKModel()` 轉換
   - 傳給 `sdkManager.executeQuery()`

3. **修改 SDKQueryManager**（`SDKQueryManager.ts`）：
   - `ExecuteQueryOptions` 加入 `model?: string`
   - 在 `sdkOptions` 中設定 `model`

---

## 總結（前半段）

| 項目 | 狀態 | 實作難度 | 備註 |
|------|:----:|:--------:|------|
| `/restart` 指令 | ✅ 完成 | 低 | PM2 + TypeScript 檢查 |
| 跨 Agent 通知 | ⏳ 待做 | 中 | 設計後做 |
| AstrBot 借鏡 | 📚 參考 | - | 長期參考 |
| MaiBot 借鏡 | 📚 參考 | - | 長期參考 |
| 表格格式化 | ⏳ 待做 | 中 | 可優先做 |
| Schedule 模型設定 | ⏳ 待做 | 低 | 可立即做 |
| 影片/動畫傳送 | ✅ 完成 | 低 | sendVideo/sendAnimation |

---

## 6. Agent 傳送影片/動畫訊息 ✅ 已完成

### 需求
讓 Agent 可以傳送影片檔案（mp4）或動畫（GIF）給使用者。

### 狀態
✅ **已完成** — 2026-02-23

**實作內容：**
- `sendVideo()` 和 `sendAnimation()` 方法已加入 `TelegramAdapter`
- `sendInlineDocuments()` 整合到 `onIntermediateMessage`（文件自動傳送）
- 支援 `.mp4`, `.mov`, `.gif` 等格式

### 現有架構
- `TelegramAdapter` 已有 `sendPhoto()` 方法
- 使用 grammY 框架，已支援 `bot.api.sendVideo()` 和 `bot.api.sendAnimation()`
- `MessageProcessor` 已有偵測圖片路徑並自動發送的機制（`extractAndSendInlineImages`）

### grammY API 支援

| 方法 | 用途 | 檔案限制 |
|------|------|----------|
| `sendVideo` | 傳送 mp4 影片 | 50 MB |
| `sendAnimation` | 傳送 GIF 或無聲 H.264/MPEG-4 | 50 MB |

**Source**: [grammY API Reference](https://grammy.dev/ref/core/api)

### 建議實作方式

**方案：參考 sendPhoto 實作 sendVideo / sendAnimation**

1. **BaseAdapter**：新增抽象方法
   ```typescript
   async sendVideo(chatId: string, filePath: string, caption?: string): Promise<SendResult>
   async sendAnimation(chatId: string, filePath: string, caption?: string): Promise<SendResult>
   ```

2. **TelegramAdapter**：實作方法
   ```typescript
   override async sendVideo(chatId: string, filePath: string, caption?: string): Promise<SendResult> {
     // 類似 sendPhoto，使用 this.bot!.api.sendVideo()
   }
   ```

3. **MessageProcessor**：擴展偵測邏輯
   ```typescript
   // 現有：IMAGE_PATH_REGEX 偵測圖片
   // 新增：VIDEO_PATH_REGEX 偵測 .mp4, .mov
   // 新增：GIF_PATH_REGEX 偵測 .gif
   ```

### 實作步驟

1. 在 `BaseAdapter.ts` 新增 `sendVideo()` 和 `sendAnimation()` 抽象方法
2. 在 `TelegramAdapter.ts` 實作這兩個方法
3. 在 `MessageProcessor.ts` 擴展路徑偵測邏輯，支援影片和 GIF
4. 測試：Agent 回覆中包含 `/path/to/video.mp4` 應自動傳送

### 使用情境

```
使用者：幫我做一個 30 秒的宣傳影片
Agent：（執行 Remotion render）
Agent：影片已完成！ F:\_Program\OwnProject\remotions\out\promo.mp4
       ↓ 自動偵測 .mp4 路徑
       ↓ 呼叫 sendVideo()
使用者：收到影片檔案
```

---

---

## 7. Agent 傳送語音訊息（TTS）

### 需求
讓 Agent 可以將文字轉語音（TTS）後傳送 Telegram 語音訊息。

### 可行性
✅ **可行，實作難度中**

### Telegram sendVoice API

| 項目 | 規格 |
|------|------|
| 方法 | `sendVoice` |
| 格式要求 | **OGG + Opus codec**（Telegram 會顯示為語音訊息） |
| 檔案限制 | 50 MB |
| 備註 | 若格式錯誤會被當成一般檔案傳送 |

**Source**: [Telegram Bot API - sendVoice](https://core.telegram.org/bots/api#sendvoice)

### TTS 方案比較

| 方案 | 費用 | 優點 | 缺點 |
|------|------|------|------|
| **OpenAI TTS** | $15/1M chars (standard)<br>$30/1M chars (HD) | 品質最高、多種聲音、直接輸出 Opus | 需要 API key、按量計費 |
| **Edge-TTS** | 免費 | 零成本、不需 API key、品質不錯 | 依賴微軟伺服器、可能有使用限制 |
| **本地 TTS** | 免費 | 完全離線、無限制 | 品質差、需要額外設定 |

### 建議方案：MiniMax Voice Clone + Speech 2.6（推薦）

**理由**：
- 可克隆喜歡的聲音，像真人而非機械
- 費用合理：每千字約 $0.03-0.05
- 品質排名 #2，自然韻律、情感細膩
- 克隆只需 5-10 秒音檔

**備用方案**：
- Edge-TTS：免費但聲音固定
- OpenAI TTS：品質好但無法克隆自訂聲音

### MiniMax Voice Clone 技術細節

| 項目 | 內容 |
|------|------|
| 克隆音源 | 5-10 秒音檔，mp3/m4a/wav，20MB 以下 |
| API | `https://api.minimax.io/v1/voice_clone` |
| 模型 | Speech 2.6 Turbo（$30/1M chars）、Speech 2.6 HD（$50/1M chars）|
| 多語言 | 克隆聲音可說 40+ 語言 |
| 注意 | voice_id **7 天內要用過一次**，否則被刪除 |

**Source**: [MiniMax Voice Clone Docs](https://platform.minimax.io/docs/guides/speech-voice-clone)

### Edge-TTS 技術細節

| 項目 | 內容 |
|------|------|
| npm 套件 | `@andresaya/edge-tts` 或 `node-edge-tts` |
| 中文語音 | `zh-TW-HsiaoChenNeural`（台灣女聲）、`zh-CN-XiaoxiaoNeural`（大陸女聲）等 |
| 輸出格式 | MP3（需轉換為 OGG/Opus）|

**Source**: [edge-tts npm](https://www.npmjs.com/package/@andresaya/edge-tts)

### OpenAI TTS 技術細節

| 項目 | 內容 |
|------|------|
| API | `POST /v1/audio/speech` |
| 模型 | `tts-1`（標準）、`tts-1-hd`（高清）|
| 聲音選項 | alloy, echo, fable, onyx, nova, shimmer |
| 輸出格式 | 可直接輸出 `opus`，無需轉換 |

**Source**: [OpenAI TTS API](https://platform.openai.com/docs/guides/text-to-speech)

### 實作步驟

1. **新增 TTS Service**（`src/services/TTSService.ts`）
   ```typescript
   interface TTSOptions {
     provider: 'edge-tts' | 'openai';
     voice?: string;
     text: string;
   }
   
   async generateSpeech(options: TTSOptions): Promise<Buffer>
   ```

2. **新增格式轉換**（若使用 Edge-TTS）
   - 使用 `ffmpeg` 或 `fluent-ffmpeg` 將 MP3 轉 OGG/Opus
   - 或找支援直接輸出 OGG 的套件

3. **擴展 TelegramAdapter**
   ```typescript
   async sendVoice(chatId: string, audioBuffer: Buffer, caption?: string): Promise<SendResult>
   ```

4. **提供 Custom Tool 給 Agent**
   - Agent 可透過 tool 呼叫：`sendVoiceMessage({ text: "任務完成", provider: "edge-tts" })`

---

## 8. 本地語音播放（任務完成通知）

### 需求
當 Agent 完成任務時，在使用者的本機電腦播放語音通知（適用於使用者在電腦前工作、沒空看 Telegram 的情況）。

### 可行性
✅ **可行，實作難度低**

### 使用場景
```
使用者在電腦前寫文件
    ↓
Coder 在背景完成程式碼修改
    ↓
ClaudeCab 偵測到任務完成
    ↓
本地播放語音：「Coder 已完成任務：修正了登入頁面的表單驗證」
```

### Node.js 本地播放方案

| 套件 | 平台支援 | 格式支援 | 特點 |
|------|----------|----------|------|
| **sound-play** | Windows, macOS | mp3, wav | 最簡單、無需外部依賴 |
| **naudiodon** | 全平台 | 多格式 | 基於 PortAudio、功能強大 |
| **play-sound** | 全平台 | 多格式 | 需安裝 MPlayer 等外部播放器 |

**Source**: [sound-play](https://github.com/nomadhoc/sound-play), [naudiodon](https://github.com/Streampunk/naudiodon)

### 建議方案：sound-play

**理由**：
- Windows/macOS 免外部依賴
- API 極簡：`sound.play("file.mp3")`
- 支援音量控制

### 實作架構

```
Agent 完成任務
    ↓
觸發 onTaskComplete hook
    ↓
TTSService.generateSpeech({ text: "任務完成摘要" })
    ↓
LocalAudioPlayer.play(audioBuffer)
    ↓
使用者聽到語音通知
```

### 實作步驟

1. **新增 LocalAudioPlayer Service**（`src/services/LocalAudioPlayer.ts`）
   ```typescript
   import sound from 'sound-play';
   
   export class LocalAudioPlayer {
     async play(filePath: string, volume: number = 0.5): Promise<void> {
       await sound.play(filePath, volume);
     }
     
     async playBuffer(buffer: Buffer): Promise<void> {
       // 寫入暫存檔 → 播放 → 刪除
     }
   }
   ```

2. **整合 TTS + 本地播放**
   - TTS 生成音檔 → 播放 → 清理暫存

3. **設定檔新增選項**
   ```yaml
   notifications:
     localAudio:
       enabled: true
       volume: 0.5
       ttsProvider: edge-tts
       voice: zh-TW-HsiaoChenNeural
   ```

4. **Hook 整合**
   - 在 `SDKQueryManager` 的 `executeQuery` 完成後觸發
   - 或在 `ScheduleExecutor` 排程完成後觸發

### 注意事項

- 僅限桌面環境（有音訊輸出設備）
- 伺服器部署時應停用此功能
- 需考慮使用者是否開啟「靜音模式」

---

---

## 9. Adjutant 播報員模組

### 需求
建立一個統一的「播報員」模組（Adjutant），負責將 Agent 的長回覆摘要成簡短通知，並透過 TTS 播報。

### 設計靈感
類似星海爭霸的 Adjutant（輔助官）：所有通知、狀態報告都由統一的聲音播報。

### 可行性
✅ **可行，實作難度中**

### 核心流程

```
Agent 回覆 2000 字的報告
    ↓
Adjutant 模組攔截
    ↓
呼叫 Haiku 摘要（prompt: 「用 50 字內摘要這則訊息的重點」）
    ↓
摘要：「Coder 完成登入表單驗證，修了 3 個 bug，已推送到 dev 分支」
    ↓
TTS 生成語音（MiniMax Voice Clone）
    ↓
輸出：本地播放 + Telegram 語音訊息（依設定）
```

### 規格

| 項目 | 決定 |
|------|------|
| 摘要生成 | Haiku 自動摘要（低成本、快速）|
| 播報時機 | 每則 Agent 回覆 + 可設定條件過濾 |
| 播報輸出 | 本地電腦播放 + Telegram 語音（可分別開關）|
| 聲音來源 | MiniMax Voice Clone（使用者克隆的聲音）|

### 架構設計

```
src/
├── services/
│   ├── AdjutantService.ts      # 播報員核心
│   ├── TTSService.ts           # TTS 生成（MiniMax/Edge/OpenAI）
│   ├── LocalAudioPlayer.ts     # 本地播放
│   └── SummaryService.ts       # Haiku 摘要
```

### AdjutantService 介面

```typescript
interface AdjutantConfig {
  enabled: boolean;
  
  // 摘要設定
  summary: {
    model: 'haiku' | 'sonnet';
    maxLength: number;  // 摘要字數上限，預設 50
    prompt?: string;    // 自訂摘要 prompt
  };
  
  // 播報條件
  trigger: {
    everyMessage: boolean;           // 每則訊息都播報
    conditions?: AdjutantCondition[]; // 額外條件（如：特定 Agent、關鍵字）
  };
  
  // 輸出設定
  output: {
    local: {
      enabled: boolean;
      volume: number;  // 0-1
    };
    telegram: {
      enabled: boolean;
      chatId?: string;  // 指定 chatId，預設為原對話
    };
  };
  
  // TTS 設定
  tts: {
    provider: 'minimax' | 'edge-tts' | 'openai';
    voiceId?: string;  // MiniMax clone voice ID
    voice?: string;    // Edge-TTS / OpenAI voice name
  };
}

interface AdjutantCondition {
  type: 'agent' | 'keyword' | 'length';
  value: string | number;
}

class AdjutantService {
  constructor(config: AdjutantConfig);
  
  // 主要方法：處理 Agent 回覆
  async processAgentResponse(
    agentId: string,
    response: string,
    chatId: string
  ): Promise<void>;
  
  // 內部流程
  private async shouldAnnounce(agentId: string, response: string): Promise<boolean>;
  private async summarize(text: string): Promise<string>;
  private async generateSpeech(text: string): Promise<Buffer>;
  private async announce(audio: Buffer, chatId: string): Promise<void>;
}
```

### 整合點

在 `MessageProcessor` 或 `SDKQueryManager` 的回覆處理流程中加入 hook：

```typescript
// SDKQueryManager.ts 或 MessageProcessor.ts
const response = await this.executeQuery(query);

// 新增：Adjutant 播報
if (this.adjutant.config.enabled) {
  await this.adjutant.processAgentResponse(agentId, response, chatId);
}

return response;
```

### 設定檔範例

```yaml
# config.yaml
adjutant:
  enabled: true
  
  summary:
    model: haiku
    maxLength: 50
    
  trigger:
    everyMessage: true
    conditions:
      - type: length
        value: 200  # 只有超過 200 字的回覆才播報
        
  output:
    local:
      enabled: true
      volume: 0.5
    telegram:
      enabled: true
      
  tts:
    provider: minimax
    voiceId: "your-cloned-voice-id"
```

### 成本估算

| 項目 | 單次成本 |
|------|----------|
| Haiku 摘要 | ~$0.0001（2000 字輸入 → 50 字輸出）|
| MiniMax TTS | ~$0.002（50 字 × $0.03/1000）|
| **合計** | **~$0.002/次** |

每天 100 次播報 ≈ $0.20/天 ≈ $6/月

### 實作步驟

1. **建立 SummaryService**
   - 封裝 Haiku API 呼叫
   - 提供可自訂的摘要 prompt

2. **建立 TTSService**
   - 支援 MiniMax / Edge-TTS / OpenAI
   - 統一輸出 OGG/Opus 格式

3. **建立 LocalAudioPlayer**
   - 使用 `sound-play` 套件
   - 支援音量控制

4. **建立 AdjutantService**
   - 整合上述三個 service
   - 處理播報條件判斷

5. **整合到 MessageProcessor**
   - 在 Agent 回覆後觸發 Adjutant

6. **新增設定檔支援**
   - `config.yaml` 加入 `adjutant` 區塊

### 未來擴展

- 不同 Agent 可配置不同聲音
- 支援播報優先級（重要通知用不同語調）
- 支援「靜音時段」設定
- 累積播報模式（N 分鐘沒看訊息才一次播報所有）

---

## 總結（完整版）

| 項目 | 狀態 | 實作難度 | 備註 |
|------|:----:|:--------:|------|
| `/restart` 指令 | ✅ 完成 | 低 | PM2 + TypeScript 檢查 |
| 跨 Agent 通知 | ⏳ 待做 | 中 | 設計後做 |
| AstrBot 借鏡 | 📚 參考 | - | 長期參考 |
| MaiBot 借鏡 | 📚 參考 | - | 長期參考 |
| 表格格式化 | ⏳ 待做 | 中 | 可優先做 |
| Schedule 模型設定 | ⏳ 待做 | 低 | 可立即做 |
| 影片/動畫傳送 | ✅ 完成 | 低 | sendVideo/sendAnimation |
| 語音訊息（TTS） | ⏳ 待做 | 中 | 需整合 TTS + 格式轉換 |
| 本地語音播放 | ⏳ 待做 | 低 | 可立即做 |
| **Adjutant 播報員** | ⏳ 待做 | 中 | 整合 #7 #8 後做 |

---

*分析者：Coder*  
*日期：2026-02-21*  
*更新：2026-02-23（新增 Adjutant 播報員模組設計、未來方向探索、標記完成項目）*

---

## 10. 未來方向探索（待設計）

以下是根據現有規劃推導出的下一步方向，尚未設計細節：

### 10.1 跨 Agent 知識庫 ✅ 確定做

**問題**：Agent 之間有通訊但沒有「共同知識」。

**設計方向**：

```
_shared/
└── knowledge/
    ├── architecture-decisions.md   # 架構決策（ADR）
    ├── project-status.md           # 各專案進度
    └── conventions.md              # 共同約定
```

**流程**：
```
Coder 做了架構決策
    ↓
寫入 _shared/knowledge/architecture-decisions.md
    ↓
notifyAgent("admin", "我更新了架構決策，請看 _shared/knowledge/architecture-decisions.md")
    ↓
Admin 下次啟動時收到通知 → 讀取該檔案
```

**設計哲學**：
- **通訊**：告訴你「有事發生」
- **知識庫**：實際的內容在這裡
- 分離關注點，避免通訊訊息過長

---

### 10.2 員工日誌與審計 ✅ 確定做

**問題**：難以回答「昨天 Agent 做了什麼」。

**設計方向**：
- Schedule 每日定時執行（例如 23:59）
- 統整當天各 Agent 的記憶變更
- 生成結構化日誌 → 存入資料庫

**日誌格式範例**：
```json
{
  "date": "2026-02-23",
  "agents": {
    "coder": {
      "tasksCompleted": ["修正登入驗證", "新增 sendDocument 功能"],
      "filesModified": ["src/adapters/TelegramAdapter.ts", "src/core/MessageProcessor.ts"],
      "memoriesUpdated": ["lessons-learned"]
    },
    "admin": {
      "tasksCompleted": ["審閱 Coder 的 skill 更新"],
      "decisions": ["採用 MiniMax Voice Clone 作為 TTS 方案"]
    }
  }
}
```

---

### 10.3 使用者狀態感知（待評估）

**問題**：Agent 不知道「你在不在」，無法調整通知策略。

**可能方向**：
- Idle detector（偵測滑鼠/鍵盤活動）
- 手動狀態切換（`/status busy` / `/status available`）
- 日曆整合（Google Calendar / Outlook）

**影響**：Adjutant 播報行為、通知累積策略

---

### 10.4 任務優先級與緊急度（待評估）

**問題**：所有 Agent 回覆一視同仁，無法區分重要性。

**可能方向**：
- Agent 回覆時標註 `urgency: high/medium/low`
- Adjutant 根據緊急度決定是否打斷

**影響**：Adjutant 觸發條件、通知頻率

---

### ~~10.5 錯誤恢復機制~~ ❌ 不做

**理由**：複雜度太高，目前 git 足夠應付回滾需求。

---

## 11. 深層意圖功能建議（2026-02-23）

以下功能建議圍繞使用者的三個深層意圖展開：

### 認知卸載（把腦中背景進程外包）

| # | 功能 | 說明 |
|---|------|------|
| 11.1 | 智能任務拆解 | 模糊指令 → 自動拆子任務 → 分配 Agent |
| 11.2 | 待辦事項擷取 | 對話中「之後要...」自動記錄 |
| 11.3 | 決策疲勞緩衝 | 小決定累積後統一問，不每次打斷 |
| 11.4 | 上下文自動重建 | 每次對話開始先說「上次講到 X」 |
| 11.5 | 擱置任務追蹤 | 「先放著」的事自動記錄並定期提醒 |

### 降低切換成本（減少離開心流的摩擦）

| # | 功能 | 說明 |
|---|------|------|
| 11.6 | 跨 Agent 任務接力 | Coder 做到需要設計 → 自動轉給設計 Agent → 完成後轉回 |
| 11.7 | 靜默完成模式 | 任務明確時做完才通知，不每步回報 |
| 11.8 | 跨裝置無縫切換 | 電腦講到一半，手機繼續 |

### 建立信任關係（從工具變成夥伴）

| # | 功能 | 說明 |
|---|------|------|
| 11.9 | 記住決策模式 | 「上次你選 A 不選 B」→ 下次直接用 A |
| 11.10 | 主動回報進度 | 長任務中途主動說進度，不用問才答 |
| 11.11 | 承認不確定性 | 不確定時明說，而不是假裝有把握 |
| 11.12 | 失敗後自動補救 | 失敗不只報錯，自動嘗試修復 |
| 11.13 | 預判式建議 | 根據偏好主動建議「這次要一起做 Z 嗎？」 |
