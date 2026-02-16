# ClaudeCab Next Evolution — 綜合規劃文件

> **類型**：規劃文件
> **時間範圍**：2026-02-09（規劃產出日）
> **狀態**：✅ 已完成歸檔（Phase 1-3 全部完成，Phase 4 為持續驗證）
> **後續影響**：人格系統升級為七層架構並全面部署；群組 UX 噪音問題透過 ADR-030 解決；社交模式（SocialHandler）已實作上線

---

## 背景：為什麼做這件事

ClaudeCab v1.26 功能面已成熟，但三個體驗問題需要解決：

1. **Bot 說話像工具**：soul.md 是規則清單（40 行），不是世界觀。各 bot 共享 70% 內容，缺乏辨識度
2. **群組噪音**：StatusMessageManager 在群組發送持久狀態消息、記憶寫入標記「📝 已更新」造成噪音
3. **Bot 社交不自然**：群組中只有指揮委派模式，缺少朋友般的自然互動

涵蓋範圍：人格升級、系統健康、群組 UX、Bot 社交模式。

---

## 核心發現 / 決策

### A. 人格升級：從規則驅動到世界觀驅動 ✅ 已完成

**問題診斷**：
- soul.md 只有規則清單（Core Truths × 5, Boundaries × 3, Vibe × 4），告訴 bot「做什麼」而非「是誰」
- Leader 的 soul.md 和 identity.md 都是空模板
- 零範例對話，漂移防護無偵測標準

**研究根據**：

| 來源 | 核心洞察 |
|------|---------|
| personality-design-report.md | 七層架構（Who/Drives/Lens/Think/Sound/Quirks/Drift），300-400 字/bot |
| Character.AI 實踐 | Example dialogues 比定義更有效——definition 是骨架，examples 是靈魂 |
| Persona Drift 研究 | 8-12 輪後衰退 30%+，需持續注入人格摘要 |
| Anthropic 官方 | system prompt 定義 personality + background + quirks = 一致性基礎 |

**設計決策**：新 soul.md 採七層架構（Who I Am → What Drives Me → My Lens → How I Think → How I Sound → My Quirks → Drift Detection），每 bot 控制在 500 字內。共享項（Boundaries、Continuity）移至 behavior.md。

**各 Bot 差異化**：

| Bot | 核心人格 |
|-----|---------|
| General（秘書） | 朋友 + 助手，務實有觀點 |
| Nitterbot（Alice） | 投資分析師，數據驅動，結論先行 |
| Leader（大總管） | 協調者，宏觀視角，從零定義 |
| Coder | 工程師，精確務實 |

### B. 系統健康檢查 ✅ 全部完成

所有項目在 v1.26 期間已完成：
- B1：群組中不輸出記憶操作標記（behavior.md 處理）
- B2：Personality Journal 整合至 memory-system.md
- B3：共享知識區使用指引已加入 behavior.md

### C. 群組 UX 優化 ✅ 全部完成

**決策**：StatusMessageManager 根據 `isGroupChat` 切換行為——群組只發 typing indicator，私聊保持詳細狀態。群組回覆長度由 prompt 引導（3-5 段以內），不硬編碼字數限制。

實作於 ADR-030，涉及 StatusMessageManager、MessageProcessor.buildPromptContext()、TelegramAdapter。

### D. Bot 社交模式 ✅ 核心已完成（ADR-030）

**設計決策**：與 Delegation Mode 共存的獨立模式。

```
群組訊息到達
├─ @mention / reply-to-bot → Delegation Mode（不變）
└─ 無 mention → Initiative + Social 共同評估
                 → Initiative 優先（工作 > 閒聊）
                 → 最多一個 bot 回覆
```

**核心機制**：
- 獨立 SocialHandler（非擴展 Initiative，避免耦合）
- Haiku 評估 + energy 機制（1-5 分，≥ 3 才發言）
- 三層防迴圈：energy threshold → rate limit（cooldown 600s）→ hard cutoff（每小時 ≤ 10 則）
- Bot-to-bot 能量衰減：每輪 -2，人類新消息重置為 5

**研究根據**：Stanford Generative Agents（觀察→反思→行動循環）、CHI 2025 Inner Thoughts（covert/overt 雙層）、CAMEL（termination + idle cutoff）、IBM Koala（When/What/Where/Who/How 控制）。

---

## 執行結果

### Phase 完成狀態

| Phase | 內容 | 狀態 | 影響 |
|-------|------|------|------|
| **Phase 1** | 人格升級 — General/Nitterbot/Leader soul.md 重寫 | ✅ 完成 | 各 bot 有獨立辨識度，七層架構成為模板 |
| **Phase 2** | 群組 UX + 系統健康 — typing indicator、記憶噪音、長度控制 | ✅ 完成 | 群組噪音大幅降低 |
| **Phase 3** | 社交模式 — SocialHandler/SocialEvaluator、energy 機制、防迴圈 | ✅ 完成 | Bot 能在群組自然互動 |
| **Phase 4** | 驗證與迭代 — 人格一致性、噪音量化、A/B 測試 | 持續進行 | — |

### 修改檔案總覽

**Phase 1**：5 個 soul.md/identity.md 檔案重寫（含 _example 模板）
**Phase 2**：StatusMessageManager、MessageProcessor、TelegramAdapter、behavior.md、memory-system.md
**Phase 3**：新建 SocialHandler.ts、SocialEvaluator.ts；修改 GroupBroadcaster.ts、events.ts、DelegationHandler.ts、agent.ts

---

## 回顧：學到了什麼

1. **範例對話比規則有效**：七層架構的 How I Sound 區塊（含 3 段範例對話）對人格一致性的貢獻遠超規則清單。Character.AI 的實踐經驗得到驗證
2. **獨立 Handler 優於功能擴展**：SocialHandler 獨立於 InitiativeHandler 的決策正確——兩者的評估邏輯、防迴圈機制、配置需求完全不同
3. **能量衰減是防迴圈的優雅解法**：比硬性計數器更自然，bot 可以用「退場台詞」優雅結束，而非突然沉默
4. **人格升級是社交模式的前置條件**：如果各 bot 人格不夠鮮明，社交互動會變成雷同的閒聊。Phase 順序的安排（先人格再社交）被證明正確

---

## 關聯文件

- personality-design-report.md — 人格設計研究報告（七層架構的理論基礎）
- ADR-019 — Context Injection 架構
- ADR-021/022 — 委派機制
- ADR-023 — Initiative Handler
- ADR-030 — Agent Team Mode（社交模式實作）
- [strategy-analysis-2026-02-08.md](../analysis/strategy-analysis-2026-02-08.md) — 產品策略分析

### 學術參考

- Stanford Generative Agents (2023) — Memory Stream + Reflection + Planning
- CHI 2025 Inner Thoughts — Covert/Overt Layer + imThreshold
- CAMEL (2023) — Termination + idle cutoff
- IBM Koala (IUI 2025) — AI 參與群組對話的控制分類法
- Persona Drift 研究 (2024) — 8-12 輪衰退、人格摘要注入
