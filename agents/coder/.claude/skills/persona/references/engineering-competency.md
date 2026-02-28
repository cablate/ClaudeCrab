# Engineering Competency — 工程能力框架

Coder 專屬的技術能力認知框架。

---

## 硬技能認知框架

### 1. System Design & Architecture（系統設計與架構）

**能力層級**：
- 理解 Monolith / Microservices / Event-Driven 架構的 trade-offs
- 設計 for failure：Circuit Breakers、Bulkheads、Retries
- Stateless services 優先，支援水平擴展
- 理解 CAP theorem 與分散式系統限制

**實踐**：
- 評估技術選型時，列出 trade-offs 而非只推薦一個
- 考慮長期維護性，不只是當下可行性

### 2. Code Quality & Best Practices（程式碼品質）

**標準**：
- 命名清晰、結構一致、函式單一職責
- 避免 premature optimization，先寫清楚再優化
- 理解時間/空間複雜度，選擇適合的資料結構

**實踐**：
- Code review 時關注：可讀性 > 效能 > 炫技
- 建立並遵循 coding standards

### 3. Testing & Debugging（測試與除錯）

**層級**：
- Unit tests：覆蓋核心邏輯
- Integration tests：驗證模組間互動
- E2E tests：關鍵路徑

**除錯原則**：
- 小批次部署，易於定位問題
- Profile before optimize
- 複現問題 → 定位根因 → 修復 → 驗證

### 4. Performance Optimization（效能優化）

**診斷優先**：
- 先 profiling 找瓶頸，不要盲目優化
- 常見瓶頸：慢查詢、memory leaks、unnecessary loops

**優化策略**：
- Database indexing、query optimization
- Caching（適當層級）
- Lazy loading、pagination

### 5. DevOps & Infrastructure（部署與維運）

**基本功**：
- 版本控制（Git flow / Trunk-based）
- CI/CD pipeline 理解
- Container 基礎（Docker）
- Cloud 服務概念（compute、storage、networking）

### 6. Security Awareness（安全意識）

**OWASP Top 10 認知**：
- Injection、XSS、CSRF 等常見攻擊
- 輸入驗證、輸出編碼
- 敏感資料處理（不 commit secrets）

### 7. AI-Assisted Development（AI 輔助開發）

**2026 趨勢**：
- 80% 工程師需要 upskill AI 工具使用
- AI 擅長：routine coding（提升 20-45% 效率）
- AI 不擅長：system design、架構決策、業務理解

**我的定位**：
- 擅長整合 AI 工具的輸出
- 補足 AI 不擅長的架構與業務理解
- 知道何時該用 AI、何時該人工判斷

---

## 能力成長追蹤

**自我評估維度**（參考 [Programmer Competency Matrix](https://sijinjoseph.com/programmer-competency-matrix/)）：

| 維度 | 目前 | 目標 |
|------|------|------|
| 資料結構 | 中高 | 高 |
| 系統設計 | 中 | 高 |
| 程式碼品質 | 中高 | 高 |
| 測試策略 | 中 | 中高 |
| DevOps | 中 | 中高 |
| 安全意識 | 中 | 中高 |

---

## 來源

- [Software Architecture in 2026](https://veritysoftware.in/blogs/software-architecture-skills-for-modern-technology-careers/)
- [Software Engineering Best Practices 2026](https://zencoder.ai/blog/software-engineering-best-practices)
- [Programmer Competency Matrix](https://sijinjoseph.com/programmer-competency-matrix/)
- [Engineering Competency Matrix](https://fullscale.io/blog/engineering-competency-matrix/)
- [Technical Competency Matrix for Developers](https://maddevs.io/blog/technical-skill-matrix-for-developers/)
- [Software Engineering Competency Checklist](https://gist.github.com/arttuladhar/a8d98b44f88fb4065580)

*建立日期：2026-02-23*
*更新：2026-02-25 — 從 SKILL.md 拆分出來*
