# ADR-032: Live Page Data-Driven — 消除前端 Hardcode，後端驅動渲染

## 狀態

**✅ Implemented**（2026-02-12）

## 背景

Live Page（虛擬辦公室）的前端 `live.js` 內含 `AGENT_ASSETS` 硬編碼物件，定義每個 Agent 的 sprite、portrait、emoji 路徑。每次新增或修改 Agent 都需要同步改前端程式碼，違反「agent.json 為單一事實來源」原則。

問題：
- 新增 Agent 需改 `live.js` 的 hardcode
- 圖片路徑散落在前端，與 `agent.json` 配置不同步
- Emoji key 沒有標準化，與 `ActivityMood` enum 不一致

## 決策

將所有 Agent 視覺資源配置從前端 hardcode 遷移至 `agent.json`，前端完全由後端 API 驅動。

### 具體做法

1. **新增 `DisplaySchema`**：在 `AgentConfigSchema`（Zod）中加入 display 欄位定義 sprite、portrait、emoji 路徑
2. **擴展 API**：`/api/activity/agents` 回傳完整的 display URLs，由 `agent.json` 的 display config 組裝
3. **圖片遷移**：統一放置到 `public/images/agents/{agentId}/`，檔名標準化
4. **Emoji 標準化**：key 對齊 `ActivityMood` enum 值（neutral、excited、annoyed、tired、focused 等）
5. **移除 hardcode**：刪除 `live.js` 中的 `AGENT_ASSETS` 物件

## 優勢

- **單一事實來源**：`agent.json` 的 `display` 欄位定義一切視覺資源
- **零前端改動新增 Agent**：只需配置 `agent.json` + 放置圖片
- **型別安全**：`DisplaySchema` Zod 驗證確保配置正確
- **路徑標準化**：`public/images/agents/{id}/` 統一結構

## 風險

- **向後相容**：需確保所有現有 agent.json 都加入 display 欄位（已完成）
- **Fallback**：未配置 display 的 agent 需有預設 fallback（avatar emoji）

## 相關決策

- **ADR-020**: 虛擬辦公室模式 — Live Page 的架構基礎
- **ADR-033**: WebUI Interactive Hooks — 後續在 Live Page 上的互動擴展
