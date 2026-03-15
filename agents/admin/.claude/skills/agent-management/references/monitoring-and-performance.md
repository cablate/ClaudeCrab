# Agent 監控與效能管理

本文件整合管理 ClaudeCab Agent 團隊所需的監控框架與效能指標。

---

## 監控三層架構（按 Token 依賴度分層）

### Layer 1：反思品質（無需 Token，隨時可執行）

**評估方式**：Admin 讀取 `evolution/weekly/` 評分
**評分標準**（滿分 5 分）：
- 符合 REFLECTION-PROTOCOL 格式 = 1
- 前日缺口追蹤有具體進度 = +1
- 搜尋記錄有 URL + 關鍵收穫 = +1
- 有應用計畫具體到場景 = +1
- 有 Meta-pattern 或提案 = +1

**初期閾值**：≥ 2/5　**穩定後閾值**：≥ 4/5

### Layer 2：知識資產（無需 Token，隨時可執行）

**評估方式**：Admin 掃描 `knowledge/` 目錄差異
**觀測項目**：
- 本週新增知識檔案數
- CLAUDE.md Lessons Learned 更新頻率
- Skill 版本演化記錄

### Layer 3：任務執行品質（需要 Token，依賴 Telegram Bot 活躍）

**核心 KPI（業界標準翻譯到 ClaudeCab 情境）**：

| 業界 KPI | ClaudeCab 指標 | 目標 |
|---------|--------------|------|
| Deflection Rate | 自主完成率：不需 Cab 介入 / 總任務 | 穩定後 > 85% |
| Time-to-Resolution | 任務完成時間：接收到產出 | 建立個人基準後追蹤趨勢 |
| Throughput | 反思品質分：缺口→搜尋→學習→寫入 | 初期 > 2/4，穩定後 4/4 |

---

## 新 Agent 上線協議（四項確認）

每個新 agent 上線時必須確認：

1. **基準 KPI 已定義**（任務類型 + 預期品質 + Layer 1-2 初始評分）
2. **Logging 機制已啟動**（任務記錄 + 反思排程 daily-reflection.yaml）
3. **依賴確認**（telegramBotToken / API keys / MCP 工具可用性）
4. **首次任務監控計畫**（Day 1-3 特別觀察，不套用嚴格評估，收集基準值）

**30-60 天改善週期**（業界標準）：
- Week 1-2：基準建立（Layer 1 每週評分）
- Week 3-4：發現問題 + 針對性學習
- Day 30：第一次正式評估
- Day 60：策略調整或基準升級

> 不要等 agent 穩定後才評估，30 天就要有第一次正式數據。

---

## 沉默代理偵測

**核心原則**：「沉默 ≠ 有問題」，但「不知道為什麼沉默 = 有問題」

**三種沉默類型**：
1. **活動沉默**：無任務輸入/輸出（可能是路由、Bot、排程問題）
2. **品質沉默**：有輸出但品質下降，無人察覺
3. **協調沉默**：多 Agent 中某 Agent 停止傳遞上下文

**Agent 無活動閾值**：

| 無活動天數 | 狀態 | Admin 行動 |
|-----------|------|-----------|
| ≤ 2 天 | 正常 | 無需行動 |
| 3-5 天 | 警告 | 確認是否有任務路由問題 |
| 5+ 天 | 危險 | 主動排查配置 |
| 14+ 天（正常沉默） | 主動確認 | 確認配置仍然正確 |

**三步驟確認流程**：
1. 排除正常沉默（有沒有任務應該路由到這個 Agent？）
2. 確認配置正常（agent.json、settings.local.json、MCP）
3. 評估影響範圍（是否影響其他 Agent？）

---

## 快速擴張期策略

當 Agent 團隊快速增長時（一週內新增 2+ 個 Agent）：

- **Progressive Scaling**：新 Agent 先小量任務驗證 ROI 再全量
- **雙軌 Onboarding**：Agent 本身（CLAUDE.md/skills/MEMORY.md）+ 監督者（Admin 建立基準）
- **Governance Agent 模式**：考慮部署獨立 governance agent 監控政策合規
- **Comprehensive Logging from Day 1**：每個決策由誰做、為什麼

---

## Admin 每週例行檢查

整合進 weekly-collaboration-review 排程：

```
對每個 Agent 確認：
□ 本週有任務嗎？→ 有/無（說明）
□ 反思品質分（Layer 1 評分）
□ 沉默天數是否超過閾值？
□ 有無需要升級的缺口（Day 3+）？
```

---

---

## Layer 1 首次基準評估（2026-03-14）

Admin 首次執行 Layer 1 反思品質評估（計畫連續 13 天後終於執行）。

### 評估結果（W11，2026-03-09 ~ 2026-03-15）

| Agent | 有 W11 記錄 | 格式 | 缺口追蹤 | URL+收穫 | 應用計畫 | Meta-pattern | 分數 |
|-------|-----------|-----|---------|---------|---------|-------------|------|
| Coder | ✅ 4 筆 | ✅ | ✅ | ✅ | ✅ | ✅ | 5/5 (A) |
| General | ✅ 5 筆 | ✅ | ✅ | ✅ | ✅ | ✅ | 5/5 (A-) |
| OSS-coder | ✅ 2 筆 | ✅ | ✅ | ✅ | ✅ | ✅ | 5/5 (A) |
| Writer | ❌ 無記錄 | — | — | — | — | — | N/A |
| SEO | ❌ 無 weekly/ | — | — | — | — | — | N/A |
| Media | ❌ 無 weekly/ | — | — | — | — | — | N/A |

### 觀察

- **Writer**：weekly/ 目錄存在但無任何記錄。可能是排程尚未觸發，或排程設定問題
- **SEO/Media**：weekly/ 目錄不存在。新建置 agent，尚未累積足夠互動啟動反思排程

### Anthropic 評估架構補充（來源：2026-03-14）

強健的 eval 框架應監控 5-7 個以上指標，涵蓋：
- 目標達成率（goal fulfillment）
- 工具呼叫準確性（tool call accuracy）
- 整體軌跡品質（trajectory quality）
- 安全性代理指標（safety proxies）
- Agent-as-a-judge 評估（使用參考場景）

---

來源：
- [AI Evaluation Metrics 2026](https://masterofcode.com/blog/ai-agent-evaluation) (2026-03-12)
- [AI Agent Monitoring Best Practices 2026](https://uptimerobot.com/knowledge-hub/monitoring/ai-agent-monitoring-best-practices-tools-and-metrics/) (2026-03-09, 2026-03-13)
- [Best Practices for AI Agent Implementations 2026](https://onereach.ai/blog/best-practices-for-ai-agent-implementations/) (2026-03-11)
- [How to Build Multi-Agent Systems 2026](https://dev.to/eira-wexford/how-to-build-multi-agent-systems-complete-2026-guide-1io6) (2026-03-11)
- [The silent failures](https://medium.com/@milesk_33/the-silent-failures-when-ai-agents-break-without-alerts-23a050488b16) (2026-03-10)
- [5 Best AI Agent Observability Tools 2026](https://www.braintrust.dev/articles/best-ai-agent-observability-tools-2026) (2026-03-13)
- [Demystifying evals for AI agents — Anthropic Engineering](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) (2026-03-14)
- [Evaluations for the agentic world — McKinsey/QuantumBlack](https://medium.com/quantumblack/evaluations-for-the-agentic-world-c3c150f0dd5a) (2026-03-14)
