# 設計：WebUI Character Sheet 整合

## Decisions

### 資料來源：Skills 目錄直讀

所有資料從 agent 的 skills 目錄讀取，無需額外資料庫：
- 角色名稱 → `persona/references/identity.md`
- 裝備列表 → `system/equipment/references/loadout.md`
- 熟練度 → `system/proficiency/references/levels.md`
- 已解鎖成就 → `system/achievements/references/unlocked.md`
- 進行中進度 → `system/achievements/references/progress.md`
- 聚合統計 → `system/character-sheet/references/stats.md`

### UI 方案：單頁面板

選擇單頁面板方案（`/agents/:agentId/character`），以 Card 區塊展示基礎資訊、裝備欄、成就、記憶深度。使用 shadcn/ui 元件（Card、Progress、Badge、Tabs）。

### API 設計

新增 `GET /api/agents/:agentId/character` 端點，回傳結構化 JSON（identity、stats、equipment、achievements）。使用正則表達式 Markdown parser 解析 skills 目錄中的 markdown 檔案。

### 導航整合

在 Agent 詳情頁的 Tabs 中新增「角色面板」分頁。

## Risks / Trade-offs

- Markdown 格式不一致可能導致 Parser 失敗（加入格式驗證 + fallback）
- 舊 agent 可能缺少相關檔案（檢查存在性，顯示「尚未啟用角色系統」）
- 多次讀檔效能問題（加入快取機制，TTL 5 分鐘）

## Affected Components

- `src/api/routes/agents/character.ts` — 新增 API 端點
- `src/web/pages/agents/[agentId]/character.tsx` — 新增前端頁面
- `src/web/pages/agents/[agentId]/index.tsx` — 導航整合
