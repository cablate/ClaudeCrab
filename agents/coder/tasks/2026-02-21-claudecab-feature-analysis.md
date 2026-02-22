# ClaudeCab 功能分析報告

**日期**：2026-02-21  
**狀態**：分析完成，待決定實作優先順序

---

## 1. TG Command 重啟伺服器（`/restart`）

### 需求
在 Telegram 新增指令，讓使用者可以在改完程式碼後直接重啟 ClaudeCab 伺服器。

### 可行性
✅ **可行，實作難度低**

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

## 5. Schedule 模型設定

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

## 總結

| 項目 | 可行性 | 實作難度 | 建議優先順序 |
|------|:------:|:--------:|:------------:|
| `/restart` 指令 | ✅ | 低 | 可立即做 |
| 跨 Agent 通知 | ✅ | 中 | 設計後做 |
| AstrBot 借鏡 | 有限 | - | 長期參考 |
| MaiBot 借鏡 | 有價值 | - | 長期參考 |
| 表格格式化 | ✅ | 中 | 可優先做 |
| Schedule 模型設定 | ✅ | 低 | 可立即做 |

---

*分析者：Coder*  
*日期：2026-02-21*
