# 設計：虛擬辦公室模式可行性評估與改進路線圖

## Decisions

### 群組記憶隔離：目錄隔離方案

Agent 的記憶系統（MEMORY.md、daily logs、memory/ 目錄）原為 agent-global，不管私聊、工作群、還是生活群，所有記憶混在同一份檔案中。

採用群組記憶目錄結構：

```
agents/{agent}/
├── MEMORY.md                    # 全局記憶（跨群組通用的事實）
├── memory/                      # 全局每日日誌
└── groups/                      # 群組專屬記憶（新增）
    └── {chatId_hash}/
        ├── GROUP_MEMORY.md      # 該群組的長期記憶
        ├── GROUP_CONTEXT.md     # 群組成員、角色定位、群組目的
        └── memory/              # 群組每日日誌
```

實作原則：
- 維持「Agent 自主管理」設計（ADR-008）— 引擎層只負責告訴 Agent 群組記憶路徑在哪
- `buildPromptContext()` 新增 `groupId` 參數，注入群組記憶路徑
- Agent 的 memory-system skill 擴展「群組記憶規則」
- 不在引擎層解析或注入記憶內容

### Agent 互相認識：DB 持久化 + Context 注入

Bot 不知道群組裡有哪些其他 Bot 存在，也不知道各自的角色和擅長領域。現有 `GroupBroadcaster.groupMemberships` 在記憶體中維護但重啟後遺失。

方案：
1. DB 持久化：新增 `group_members` 表（platform, chat_id, agent_id, joined_at）
2. GroupBroadcaster `registerBotInGroup()` 同步寫入 DB
3. 啟動時從 DB 恢復 `groupMemberships`
4. ContextInjector 注入成員清單（包含 @username、名稱、角色描述），並提示「如需其他成員協助，可在回覆中建議用戶 @mention 對應的成員」

### 被動觀察與記憶寫入：記憶寫入提示

ADR-019 正確移除了 silent/observe mode（避免 token 浪費），但 Bot 不被 @mention 時完全不會記住群組裡發生的事。Context Injection 已解決「看到」的問題，缺少的是「記住」。

方案：當 Bot 被 @mention 且有 injection context 時，在注入文本尾部加入提示，讓 Bot 在被喚醒時順便整理之前錯過的群組動態到群組記憶。不需要額外的 SDK query。

### 委派機制暫不自動化

Bot A 無法直接叫 Bot B 做事。先透過約定繞過：Agent 在回覆中建議用戶 @mention 其他 Bot。自動 @mention 轉發涉及循環風險，Phase 1 不做。

### Phase 2：Token 追蹤與 Agent 卡片 Dashboard

- 新增 `query_usage` 表記錄每次查詢的 token 用量
- MessageProcessor 在 post-query 階段記錄 usage 到 DB
- WebUI Dashboard 新增 `/dashboard/team` 路由，顯示 Agent 卡片（頭像、角色、對話數、Token 消耗、Agent 自撰心聲）

## Risks / Trade-offs

- 群組記憶目錄增加了檔案系統的複雜度，但保持了 Agent 自主管理的設計原則
- 記憶寫入提示依賴 Bot 的 LLM 判斷力，可能不會每次都正確執行
- 注入的歷史有 50 條限制，超過限制的早期討論仍可能遺失
- 委派暫不自動化，使用者需手動轉發 @mention 建議
- 自動 @mention 轉發機制的循環安全設計待驗證需求後再議
- Token 追蹤的具體粒度（per-query vs per-session vs per-day）待定

## Affected Components

Phase 1：
- `src/core/constants.ts` — `buildPromptContext()` 加入群組路徑提示
- `src/persistence/DatabaseManager.ts` — Schema v6 新增 group_members 表
- `src/core/GroupBroadcaster.ts` — 持久化成員關係、啟動恢復
- `src/core/ContextInjector.ts` — 注入成員清單、formatHistory() 加入記憶提示
- 新增 `src/persistence/GroupMemberRepository.ts`
- `agents/_example/` — 新增群組記憶目錄模板
- Agent skills（memory-system.md）— 群組記憶讀寫規則

Phase 2：
- `src/persistence/DatabaseManager.ts` — 新增 query_usage 表
- `src/core/MessageProcessor.ts` — 記錄 usage
- `src/webui/` — Dashboard 統計 UI
