# Tasks

## Phase 1：群組協作基礎

- [x] 群組成員持久化（DB Schema v6 + group_members 表 + GroupMemberRepository）
- [x] GroupBroadcaster registerBotInGroup() 同步寫入 DB + 啟動恢復
- [x] 群組成員注入（ContextInjector 注入 Agent name/description 到群組 context）
- [x] 群組記憶目錄規範（buildPromptContext 新增 groupId 參數 + 群組記憶路徑提示）
- [x] agents/_example/ 新增群組記憶目錄模板
- [x] Agent memory-system skill 擴展群組記憶規則
- [x] 群組記憶寫入提示（ContextInjector formatHistory 加入記憶提示）

## Phase 2：Dashboard 增強

- [x] Token 用量追蹤（query_usage 表 + MessageProcessor 記錄 result.usage）
- [x] Agent 卡片 Dashboard（WebUI /dashboard/team 路由 + 員工心聲卡片 UI）
