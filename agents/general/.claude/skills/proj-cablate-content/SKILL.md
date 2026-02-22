---
name: proj-cablate-content
description: |
  @cab_late 內容系統規劃。觸發時機：使用者要討論、執行、或更新 cab_late Threads 帳號的內容策略、資料收集流水線、分析方法論時。
  ⚠️ 狀態：規劃中（Planning）— 基礎設施尚未建設完成，需要使用者介入。
  主動更新時機：基礎設施完成一個階段時更新對應狀態；發現新的分析框架或內容策略時更新 references/。
---

# @cab_late 內容系統

> ⚠️ **狀態：規劃中** — 以下為完整規劃，尚待使用者逐步建設基礎設施。
> 每完成一個階段，請更新對應的 `[ ]` 為 `[x]`。

---

## 定位

**核心差異化**：不做情報彙整，做**本質解析**

| 市場上在做的 | @cab_late 要做的 |
|---|---|
| 「這個工具能幹嘛」 | 「這個技術本質是什麼、為什麼現在才出現」 |
| 情報快報、限免通知 | 拆解焦慮、還原技術真相 |
| 給大眾看 | 給有在動手做的人看 |

**標籤**：反焦慮 × AI 實戰 × 本質解析

---

## 分析方法論：六問框架

收到一則 AI 新聞時，依序問：

1. **這是什麼？**（一句話說清楚）
2. **為什麼現在才出現？**（技術條件、市場條件）
3. **它解決了什麼根本問題？**（不是表面功能）
4. **誰真正受益？誰受威脅？**
5. **六個月後這件事重不重要？**（過濾短期噪音）
6. **用一個大家已經懂的東西來比喻，它的本質是什麼？**（讓人秒懂的類比）

> 範例：「RAG 本質上就是讓 AI 考試時可以翻筆記」
> 範例：「Agent 本質上就是會自己按按鈕的 ChatGPT」

---

## 資料來源

### 第一級（每天必看，高信噪比）

| 來源 | 類型 | RSS |
|---|---|---|
| TLDR AI | Email/RSS | `https://tldr.tech/ai/rss` |
| Import AI (Jack Clark) | RSS | `https://jack-clark.net/feed/` |
| Hacker News | RSS | `https://news.ycombinator.com/rss` |
| AlphaSignal | RSS | `https://alphasignal.ai/` |

### 第二級（每週補充）

| 來源 | 類型 |
|---|---|
| The Batch (Andrew Ng) | Email/RSS |
| Ben's Bites | Email/RSS |
| @karpathy (Twitter/X) | 手動追蹤 |
| @ylecun (Twitter/X) | 手動追蹤 |

### 第三級（華文市場觀察）

| 帳號 | 平台 | 用途 |
|---|---|---|
| @prompt_case | Threads | 看什麼話題在華文圈發酵 |
| @future.ai.tw | Threads | AI 工具情報 |
| @daily146_ | Threads | AI 應用實戰 |

---

## 自動化流水線

### Phase 1：最小可行版 ⬅️ 從這裡開始

**需要使用者完成：**
- [ ] 在 Feedly Pro 訂閱上方列出的第一級來源
- [ ] 每天花 15 分鐘掃一遍，用六問框架選一則分析

**不需要任何工具，今天就能開始。**

---

### Phase 2：n8n 自動推送（基礎設施待建）

**需要使用者完成：**
- [ ] 建立 n8n workflow（可用現成模板）
- [ ] 設定 RSS 來源節點
- [ ] 接上 Claude/GPT 做摘要 + 重要性標記
- [ ] 推送到 Telegram 私人頻道

**參考模板**：
- [n8n #6011 — RSS + LLaMA → Telegram](https://n8n.io/workflows/6011-daily-ai-news-digest-with-rss-llama-32-summarization-and-telegram-delivery/)
- [n8n #9155 — Google News + Hacker News + GPT-4 → Telegram](https://n8n.io/workflows/9155-daily-ai-news-monitoring-and-summarization-with-gpt-4-from-google-and-hacker-news-to-telegram/)

**流程圖：**
```
n8n 排程（每天早上）
  → 抓 RSS + Hacker News
  → Claude 過濾「真正新」的內容
  → 摘要 + 重要程度標記
  → 推送 Telegram 私人頻道
  → 你選題 → 六問分析 → 發文
```

---

### Phase 3：Apify 社群監控（基礎設施待建）

**需要使用者完成：**
- [ ] 申請 Apify 帳號
- [ ] 設定 Twitter/Threads scraper，追蹤 @karpathy、@ylecun 等帳號
- [ ] 整合進 n8n，把高互動 AI 貼文也推進 Telegram

---

## 內容生產節奏

| 類型 | 頻率 | 格式 |
|---|---|---|
| 本質解析 | 每週 2-3 篇 | 長文 Threads（主力內容） |
| 快速觀察 | 每天 1 則 | 短貼文，一個問題或一個發現 |
| 實戰心得 | 每週 1 篇 | 自己用 AI 工具的實際體驗 |

**最佳發文時間**：平日早上 8-9 點、下午 3-5 點

---

## 參考文件

| 文件 | 內容 |
|---|---|
| [competitors.md](references/competitors.md) | 競品帳號分析（@prompt_case 等） |
| [post-examples.md](references/post-examples.md) | 優秀貼文範例與解析 |
