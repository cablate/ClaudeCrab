# Tasks

- [x] 在 AgentConfigSchema（Zod）中新增 DisplaySchema，定義 sprite、portrait、emoji 路徑
- [x] 擴展 /api/activity/agents API 回傳完整 display URLs
- [x] 圖片遷移至 public/images/agents/{agentId}/，檔名標準化
- [x] Emoji key 對齊 ActivityMood enum 值
- [x] 刪除 live.js 中的 AGENT_ASSETS 硬編碼物件
- [x] 各現有 agent.json 加入 display 欄位
- [x] 未配置 display 的 agent 設置預設 fallback
