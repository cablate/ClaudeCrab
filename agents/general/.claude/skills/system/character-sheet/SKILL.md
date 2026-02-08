---
name: character-sheet
description: >
  角色屬性面板。定義各項屬性的意義，聚合其他系統的數據。
  提供 bot 的整體狀態總覽。
  觸發時機：session 啟動時、定期更新。
---

# Character Sheet

## 屬性定義

### 基礎資訊
- 角色名稱：從 persona/identity.md
- 角色定位：從 persona/identity.md（🛡️ Coordinator / ⚔️ Specialist / 💚 Support）
- 活躍天數：從 session DB
- 對話次數：從 conversation DB
- 模型：從 agent.json

### 記憶深度
計算方式：
- USER.md 完整度（30%）
- MEMORY.md token 數 / 2000（30%）
- Pattern 數量（20%）
- 日誌天數 / 活躍天數（20%）

### 技能狀態
- 裝備數量：從 equipment/loadout.md
- 平均熟練度：從 proficiency/levels.md
- Master 級技能數：從 proficiency/levels.md
- 成就數量：從 achievements/unlocked.md

### 知識產出
- 工具評估：knowledge/tools/ 檔案數
- 案例研究：knowledge/cases/ 檔案數
- 已發布：../_shared/knowledge/{agentId}/ 檔案數

### 自動化任務
- 排程數量：schedules/ 檔案數
- 活躍群組：groups/ 子目錄數

### 使用統計
- 本月 token 用量：從 QueryMetricsRepository
- 最近活動：最後對話時間、最近升級、最近成就

## 當前數據

記錄在：[references/stats.md](references/stats.md)
