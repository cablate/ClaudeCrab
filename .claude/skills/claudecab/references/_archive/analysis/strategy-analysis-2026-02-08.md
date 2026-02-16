# ClaudeCab 產品策略分析報告

> **類型**：策略分析
> **時間範圍**：2026-02-08（單日產出）
> **狀態**：✅ 已完成歸檔（歷史文件，不再更新）
> **後續影響**：確立了「Skill 培養皿」作為核心護城河的產品定位，定義了與 OpenClaw 的側翼競爭策略，短中長期行動建議已部分落實於後續版本迭代

---

## 背景：為什麼做這件事

ClaudeCab v1.26 核心功能（Telegram adapter、記憶系統、排程、群組多 bot 協作）已到位，需要釐清產品定位與下一步方向。主要問題：

1. ClaudeCab 與 Claude Code 的關係是什麼？（互補而非競爭）
2. 面對 OpenClaw（145K+ stars）等競品，如何差異化？
3. 什麼是讓使用者離不開的核心價值？

---

## 核心發現 / 決策

### 一、產品定位：備料 vs 做菜

ClaudeCab 不取代 Claude Code，而是讓 Claude Code 的能力延伸到手機、日常生活、團隊協作。

| 維度 | Claude Code | ClaudeCab |
|------|:-----------:|:---------:|
| 隨時隨地下指令（手機） | ❌ | ✅ Telegram |
| 記憶跨 session | ❌ | ✅ 持續累積 |
| 定時自動執行 | ❌ | ✅ Cron + 主動通知 |
| 多角色分頭研究 | ❌ | ✅ 群組多 bot 協作 |
| 主動提醒 | ❌ | ✅ Initiative + Scheduling |

**工作流模型**：ClaudeCab 負責備料（手機端研究、排程、多角色分析），Claude Code 負責做菜（IDE 環境中的重度開發）。

### 二、核心護城河：Skill 培養皿

> Bot 不是產品，bot 養出的 skill 才是。

與競品方案的關鍵差異：

| 特性 | ClaudeCab Skill | Mem0 | Vector DB | Fine-tuning |
|------|:-:|:-:|:-:|:-:|
| 人類可讀 | ✅ 純 Markdown | ❌ | ❌ | ❌ |
| 可攜帶 | ✅ 複製目錄 | ❌ 綁平台 | ❌ 綁 DB | ❌ 綁模型 |
| 可編輯 | ✅ 直接改檔案 | ❌ | ❌ | ❌ |
| 版本控制 | ✅ Git | ❌ | ❌ | ❌ |
| 成本 | 零 | 付費 API | DB 費用 | GPU 費用 |
| 跨模型 | ✅ 任何 LLM | ❌ | 部分 | ❌ |

**核心差異**：ClaudeCab 的 skill 是「用出來的」（日常使用中自然成長），不是「寫出來的」（開發者手動上傳）。

### 三、頭號競品分析：OpenClaw

| 功能 | OpenClaw | ClaudeCab | 優勢方 |
|------|----------|-----------|--------|
| Agent 架構 | 單一 Agent | 多 Agent（目錄即代理） | **ClaudeCab** |
| LLM 支援 | 多模型 | Claude 專屬（SDK 深度整合） | 各有優勢 |
| 通訊平台 | 10+ 平台 | Telegram 為主 | **OpenClaw** |
| 記憶系統 | Markdown + BM25/向量混合 | Markdown + 純文字 | **OpenClaw** |
| Skill 生態 | ClawHub 5,705+ 社群 skill | 少量自建 | **OpenClaw** |
| 群組多 bot 協作 | ❌ | ✅（ADR-021~030） | **ClaudeCab** |
| 工作區隔離 | 單一工作區 | 每 Agent 獨立 + PathValidator | **ClaudeCab** |
| SDK 整合深度 | 輕度（API 層） | 深度（resume, hooks, skills） | **ClaudeCab** |
| 安全性 | 多篇安全警告 | PathValidator + 權限審批 | **ClaudeCab** |

**競爭策略：側翼戰**（不正面硬碰社群規模），強調多 Agent 協作、skill 培養（非安裝）、Claude SDK 深度整合、安全第一。

### 四、黏著力飛輪

1. **資料黏著**（3 天）：記憶累積 → 轉換成本
2. **習慣黏著**（2 週）：早安報告等排程嵌入日常
3. **能力黏著**（1 個月）：skill 在使用中成長，僅存在於你的 bot

### 五、差異化定位語

| 受眾 | 定位語 |
|------|--------|
| 技術使用者 | 把 Claude Code 變成你的 24 小時隨身 AI 團隊 |
| 非技術使用者 | 在 Telegram 裡記住你所有事的 AI 秘書 |
| 投資人 | AI 能力標準化的培養皿——bot 養 skill，skill 為所有 AI 賦能 |
| 開發者社群 | 最輕量的多代理框架：一個目錄 = 一個 Agent |

---

## 執行結果

### 行動建議與後續落實

**短期（1-2 週）**：
- ✅ 改善群組噪音（Tier 1.3 已完成）
- 優化早安報告模板、備忘快捷 skill、記憶寫入品質

**中期（1-2 月）**：
- Skill 匯出功能、記憶視覺化（WebUI）、跨 bot skill 共享

**長期（3-6 月）**：
- Skill 品質追蹤、Skill 市集、企業版授權

**明確不做**：完整 IDE 體驗、瀏覽器自動化、自建 LLM 推理層、DAG workflow 引擎。

### 市場數據快照（2026-02-08）

| 指標 | 數據 |
|------|------|
| OpenClaw GitHub stars | 145,000+ |
| OpenClaw ClawHub skills | 5,705+ |
| Mem0 融資 | $24M（2025 Series A） |
| Kin 用戶 | 50,000+ |
| SkillsMP skills | 25,000+ |
| AGENTS.md 採用 | 20,000+ repos |
| Manus 估值 | $2B（被 Meta 收購） |
| CrewAI 融資 | $18M |

---

## 回顧：學到了什麼

1. **定位清晰度是最重要的決策**：「備料 vs 做菜」的比喻讓 ClaudeCab 與 Claude Code 的關係一目了然，避免了試圖取代的陷阱
2. **護城河在 skill 不在 bot**：bot 是載體，skill 才是資產。這個洞察定義了後續所有產品化方向
3. **側翼戰優於正面對抗**：面對 OpenClaw 的社群規模優勢，選擇在多 Agent 協作和 skill 培養兩個維度建立差異，而非追逐平台數量或 skill 數量
4. **安全性可以是賣點**：OpenClaw 的安全爭議反而為 ClaudeCab 的 PathValidator + 權限審批設計提供了正面敘事空間

---

## 關聯文件

- [Skill-Based Character System](../system/skill-based-character-system.md) — skill 系統的技術設計
- [MMORPG Skill System 設計](../product/mmorpg-skill-system.md) — 角色養成機制
- [personality-design-report.md](../_archive/research/) — 人格設計研究（如已歸檔）
- ADR-021~030 — 群組協作相關架構決策
