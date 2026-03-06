# Tasks

## Phase 1：人格升級
- [x] 重寫 General 的 soul.md（七層架構）
- [x] 重寫 Nitterbot 的 soul.md
- [x] 從零建立 Leader 的 soul.md + identity.md
- [x] 更新 _example 模板

## Phase 2：群組 UX + 系統健康
- [x] behavior.md 更新記憶標記模式區分
- [x] memory-system.md 新增 Personality Journal 區塊定義
- [x] behavior.md 加入共享知識區使用指引
- [x] StatusMessageManager 群組中改用 typing only
- [x] MessageProcessor buildPromptContext 強化群組提示
- [x] 記憶噪音雙層防護（agent skill 協議 + runtime prompt injection）

## Phase 3：社交模式
- [x] 新建 SocialHandler + SocialEvaluator
- [x] Haiku 評估 + energy 機制
- [x] 防迴圈機制（energy decay + rate limit + hard cutoff）
- [x] agent.json 新增 social 配置
- [x] isSocial flag + DelegationHandler 跳過
- [x] GroupBroadcaster 新增 social 評估入口

## Phase 4：驗證與迭代（持續進行）
- [ ] 人格一致性測試（20 輪對話）
- [ ] 群組噪音量化比較（改前 vs 改後）
- [ ] 社交模式 A/B 測試（開啟 vs 關閉）
