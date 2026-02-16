> **⚠️ 歷史文件 — 已策展歸檔**：策展版本請見 [`_archive/research/moltbot-gap.md`](../_archive/research/moltbot-gap.md)
> 本檔案為原始開發紀錄，保留供完整追溯。

# Moltbot 機制差距分析

> 基於 Moltbot 官方文件（docs.molt.bot）與目前 agents/general/ 實作的逐項對照。
> 日期：2026-01-28

---

## 目錄

1. [已實作的機制](#1-已實作的機制)
2. [需修正的實作](#2-需修正的實作)
3. [建議新增的機制](#3-建議新增的機制)
4. [不適用的機制](#4-不適用的機制)
5. [實施計畫](#5-實施計畫)

---

## 1. 已實作的機制

以下機制已在 agents/general/ 中正確實作：

| 機制 | Moltbot 對應 | 實作位置 | 狀態 |
|------|-------------|----------|------|
| AGENTS.md → CLAUDE.md | 行為手冊、記憶協議、安全邊界 | `agents/general/CLAUDE.md` | 完成 |
| SOUL.md | 人格基底 | `agents/general/SOUL.md` | 模板已建立 |
| USER.md | 使用者檔案 | `agents/general/USER.md` | 模板已建立 |
| IDENTITY.md | AI 身份 | `agents/general/IDENTITY.md` | 模板已建立 |
| MEMORY.md | 長期記憶 | `agents/general/MEMORY.md` | 空結構已建立 |
| memory/ 每日日誌 | 每日 context 記錄 | `agents/general/memory/` | 目錄已建立 |
| Startup Protocol | session 啟動讀取順序 | CLAUDE.md 內 | 完成（缺 HEARTBEAT、BOOTSTRAP） |
| 記憶寫入規則 | 依內容類型寫入不同檔案 | CLAUDE.md 內 | 完成（教訓位置需修正） |
| Safety 邊界 | 讀自由、外部行動先問 | CLAUDE.md 內 | 完成 |
| 動態 SystemPrompt | Agent 自主更新 CLAUDE.md 即時生效 | v1.5.1 引擎層 | 完成 |

---

## 2. 需修正的實作

### 2.1 教訓寫入位置：SOUL.md → CLAUDE.md ✅ 已修正

**現狀：**

```markdown
| 學到的教訓、犯的錯 | SOUL.md（加到適當區段）|
```

**官方設計：**

> | 學到的教訓 | AGENTS.md 或 TOOLS.md |
> | 犯過的錯 | AGENTS.md |

來源：官方 AGENTS.md 模板（https://docs.molt.bot/reference/templates/AGENTS）

**為什麼要改：**

- SOUL.md 是**人格定義**（穩定、緩慢演化）— 放教訓會讓它臃腫
- AGENTS.md（= CLAUDE.md）是**行為手冊**（規則隨經驗累積）— 教訓本質就是「操作手冊的修正」
- 官方生命週期範例：AI 犯錯 → 記錄到每日日誌 → 在 AGENTS.md 加入規則 → 往後每次 session 讀到規則，不再犯同樣的錯

**改動：** CLAUDE.md 記憶寫入規則表中，將教訓寫入目標從 SOUL.md 改為 CLAUDE.md 自身。

---

## 3. 建議新增的機制

### 3.1 BOOTSTRAP.md — 首次啟動儀式 ✅ 已實作

**官方定義：**

一次性的 onboarding 檔案，僅在全新 workspace 中存在。

**官方模板核心流程：**

> "You just woke up. Time to figure out who you are."

1. **自我發現**（跟使用者對話）：
   - 決定名字
   - 定義本質（AI? digital companion? familiar?）
   - 確立溝通風格
   - 選擇代表 emoji

2. **記錄結果**（寫入檔案）：
   - IDENTITY.md — 名字、人格
   - USER.md — 使用者資訊、偏好
   - SOUL.md — 價值觀、行為準則

3. **可選的頻道設定**：
   - Web chat / WhatsApp / Telegram

4. **完成**：
   > "Delete this file. You don't need a bootstrap script anymore — you're you now."
   > "Good luck out there. Make it count."

**設計理念：**

把首次啟動設計成 "genuine becoming" 而非 "mere configuration"。讓 agent 不是被動配置，而是跟使用者一起完成「我是誰」的建立過程。

**可跳過：** 設定 `agent.skipBootstrap: true`，或直接不放 BOOTSTRAP.md。

**ClaudeCab 適配方式：**

在 Startup Protocol 中加一條規則：

```
如果 BOOTSTRAP.md 存在 → 讀取它，執行首次啟動儀式，完成後刪除此檔案
```

Agent 用 Read 檢查存在性、完成流程後用工具刪除。檔案存在 = 新 workspace；不存在 = 已啟動過。

**改動：**
1. 新增 `agents/general/BOOTSTRAP.md`（首次啟動儀式指令）
2. CLAUDE.md Startup Protocol 加入 BOOTSTRAP.md 檢查

---

### 3.2 Auto-flush — 長對話記憶保護 ✅ 已實作（行為規則模擬）

**官方定義：**

compaction 前自動觸發的 silent agentic turn，讓 agent 把重要記憶存檔。

**官方運作細節：**

- **觸發條件**：token 估算達到 `contextWindow - reserveTokensFloor - softThresholdTokens`
- **預設 soft threshold**：4,000 tokens
- **行為**：執行 silent agentic turn（使用者不可見）
- **預設 prompt**：`"Session nearing compaction. Store durable memories now."`
- **Agent 行為**：寫入 `memory/YYYY-MM-DD.md`，回覆 `NO_REPLY`
- **頻率**：每次 compaction 週期一次
- **限制**：workspace 唯讀時跳過

**配置：**

```json5
{
  agents: {
    defaults: {
      compaction: {
        reserveTokensFloor: 20000,
        memoryFlush: {
          enabled: true,
          softThresholdTokens: 4000,
          systemPrompt: "Session nearing compaction. Store durable memories now.",
          prompt: "Write any lasting notes to memory/YYYY-MM-DD.md; reply NO_REPLY if nothing."
        }
      }
    }
  }
}
```

**ClaudeCab 適配方式：**

SDK 層面無法偵測 context window 剩餘量，也無法插入 silent turn。只能透過 CLAUDE.md 行為規則模擬：

```markdown
### 對話保護
- 當對話變長時，主動把重要內容寫入 memory/今天.md
- 不要等使用者提醒 — 如果這個 session 有值得記住的東西，趁還在 context 裡就寫下來
- 對話接近尾聲時，回顧是否有值得記錄的內容
```

**改動：** CLAUDE.md 加入對話保護規則段落。

---

### 3.3 TOOLS.md — 環境特定備註

**官方定義：**

> "Skills define *how* tools work. This file is for *your* specifics — the stuff that's unique to your setup."

**官方模板內容範例：**
- Camera 名稱和位置
- SSH hosts 和 aliases
- TTS 偏好（聲音、喇叭）
- 裝置暱稱
- 任何環境特有的東西

**設計理念：**

> "Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure."

本質上是 **「我的環境 cheat sheet」**，跟 skill/工具文件分離。

**ClaudeCab 適配方式：**

對 `agents/general/`（通用助手）用處不大 — 通用助手主要做對話。
對 `agents/coder/`（程式碼助手）有價值 — 可放開發環境偏好（pnpm vs npm、Vitest vs Jest、路徑注意事項等）。

**改動：** 暫不建立。未來若需要可選擇性加入。

---

## 4. 不適用的機制

### 4.1 HEARTBEAT.md — 定期巡邏排程

**官方機制：** Gateway 排程器每 30 分鐘觸發 heartbeat turn，agent 讀取 HEARTBEAT.md 執行定期檢查（掃收件匣、查行事曆等），沒事回覆 `HEARTBEAT_OK`。

**不適用原因：** ClaudeCab 沒有 Gateway 排程器，agent 只在收到使用者訊息時啟動。HEARTBEAT 的核心價值（自主定期巡邏）需要程式層排程配套，純靠 CLAUDE.md 指令無法實現。曾嘗試降級為「跨 session 待辦清單」，但語義偏離官方設計太遠，決定不實作。

### 4.2 BOOT.md — Gateway 重啟指令

**官方定義：** Gateway 重啟時要執行的短指令（例如「通知使用者系統重啟了」）。

**不適用原因：** ClaudeCab 沒有長駐 Gateway daemon，不需要重啟指令。

### 4.3 向量語義搜尋

**官方機制：** 自動建立 memory/ 目錄的 embedding 索引，支援 `memory_search` 語義查詢。

**不適用原因：** Phase 0 不啟用外部依賴。MEMORY.md 手動策展替代。未來可作為 Phase 2 升級路徑。

### 4.4 Cron 排程

**官方機制：** 精確定時任務（`moltbot cron add --cron "0 7 * * *"`）。

**不適用原因：** ClaudeCab 無 cron 機制。未來若整合完整 Moltbot Gateway 可啟用。

---

## 5. 實施結果

### 已完成

| 項目 | 改動 | 狀態 |
|------|------|------|
| 教訓寫入位置修正 | CLAUDE.md：教訓路由 SOUL.md → CLAUDE.md Lessons Learned 區段 | ✅ |
| BOOTSTRAP.md | 新增首次啟動儀式 + CLAUDE.md Startup Protocol 加檢查 | ✅ |
| Auto-flush 對話保護 | CLAUDE.md 新增「對話保護」行為規則區段 | ✅ |
| Lessons Learned 區段 | CLAUDE.md 尾部新增空區段，供 agent 自行寫入教訓 | ✅ |

### 決定不做

| 項目 | 原因 |
|------|------|
| HEARTBEAT.md | 需要排程器配套，純 CLAUDE.md 指令無法實現定期巡邏 |
| TOOLS.md | general agent 不需要，未來 coder agent 可加入 |

### 變更清單

| 檔案 | 操作 |
|------|------|
| `agents/general/CLAUDE.md` | **修改**：教訓路由 + Lessons Learned 區段 + BOOTSTRAP 到 Startup Protocol + 對話保護規則 |
| `agents/general/BOOTSTRAP.md` | **新增**：首次啟動儀式指令 |

### 不改的東西

| 項目 | 原因 |
|------|------|
| `src/` 任何程式碼 | 所有新增機制都是 agent 層面，零引擎改動 |
| `SDKQueryManager` | 保持可獨立抽離 |
| `MessageProcessor` | 不注入記憶邏輯 |
| `agents/coder/` | 先只改 general |

---

## 參考來源

| 頁面 | 內容 |
|------|------|
| [docs.molt.bot/concepts/memory](https://docs.molt.bot/concepts/memory) | 記憶系統、Auto-flush、向量搜尋 |
| [docs.molt.bot/concepts/agent-workspace](https://docs.molt.bot/concepts/agent-workspace) | Workspace 目錄結構、Bootstrap 檔案 |
| [docs.molt.bot/concepts/agent](https://docs.molt.bot/concepts/agent) | Agent 配置、Bootstrap 流程 |
| [docs.molt.bot/concepts/context](https://docs.molt.bot/concepts/context) | Context 組裝、Bootstrap 注入順序 |
| [docs.molt.bot/concepts/system-prompt](https://docs.molt.bot/concepts/system-prompt) | System Prompt 模板、Prompt Modes |
| [docs.molt.bot/gateway/heartbeat](https://docs.molt.bot/gateway/heartbeat) | Heartbeat 排程、配置、HEARTBEAT_OK |
| [docs.molt.bot/automation/cron-vs-heartbeat](https://docs.molt.bot/automation/cron-vs-heartbeat) | Heartbeat vs Cron 比較 |
| [docs.molt.bot/reference/templates/AGENTS](https://docs.molt.bot/reference/templates/AGENTS) | AGENTS.md 官方模板 |
| [docs.molt.bot/reference/templates/HEARTBEAT.md](https://docs.molt.bot/reference/templates/HEARTBEAT.md) | HEARTBEAT.md 官方模板 |
| [docs.molt.bot/reference/templates/BOOTSTRAP.md](https://docs.molt.bot/reference/templates/BOOTSTRAP.md) | BOOTSTRAP.md 官方模板 |
| [docs.molt.bot/reference/templates/TOOLS.md](https://docs.molt.bot/reference/templates/TOOLS.md) | TOOLS.md 官方模板 |
| [docs.molt.bot/reference/templates/SOUL.md](https://docs.molt.bot/reference/templates/SOUL.md) | SOUL.md 官方模板 |
| [docs.molt.bot/reference/templates/BOOT.md](https://docs.molt.bot/reference/templates/BOOT.md) | BOOT.md 官方模板（不適用） |
