# WebUI Character Sheet 整合

## Why

ClaudeCab 已部署 Skill-Based Character System，bot 具備裝備、熟練度、成就等 RPG 風格資料，但這些資料分散在各 agent 的 skills 目錄中，使用者無法直觀查看 bot 的成長狀態。

## What Changes

在 Dashboard 新增 Character Sheet 頁面（`/agents/:agentId/character`），從 agent skills 目錄讀取結構化資料並視覺化呈現：
- 角色名稱與基礎統計（活躍天數、對話次數）
- 裝備欄（已安裝 Skills + MCPs 及其熟練度星級）
- 成就系統（已解鎖 + 進行中進度條）
- 記憶深度指標

## Capabilities

- 可視化成長：使用者看得見 bot 的進步
- 遊戲化體驗：RPG 風格增加使用黏性
- 差異化特色：競品沒有的「bot 養成」概念
- 零侵入：讀取現有檔案，不需修改 bot 邏輯
- 易維護：資料由 bot 自行更新，WebUI 只負責展示
