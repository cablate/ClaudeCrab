# ClaudeCab x MMORPG：Skill 管理系統設計

> **核心構想**：把 MMORPG 的角色養成機制搬到 AI Bot 管理上，讓「養 bot」像「養角色」一樣有成就感。

---

## 概念映射總覽

| MMORPG 概念 | ClaudeCab 對應 | 現狀 | 可行性 |
|------------|---------------|------|--------|
| 職業系統（Class） | Agent 角色定位 | ✅ 已有（persona skill） | 可強化 |
| 裝備系統（Equipment） | MCP + Skills 配置 | ✅ 已有（equipment skill + loadout.md） | WebUI 整合中 |
| 熟練度（Proficiency） | Skill 隨使用進化 | ✅ 架構已建（proficiency skill，general 已遷移） | Stop Hook 驅動追蹤 |
| 技能樹（Skill Tree） | Skill 專精路線 | ❌ 尚無 | 中期規劃 |
| 角色面板（Character Sheet） | Bot 能力看板 | ✅ 架構已建（character-sheet skill，general 已遷移） | WebUI 整合中 |
| 配裝系統（Loadout） | 情境配置切換 | ❌ 尚無 | 中期規劃 |
| 公會系統（Guild） | 群組多 bot 協作 | ✅ 已有（ADR-020~030） | 可強化 |
| 成就系統（Achievement） | Bot 成長里程碑 | ✅ 架構已建（achievements skill，general 已遷移） | Stop Hook 驅動追蹤 |
| 製作系統（Crafting） | 從經驗萃取新 Skill | 🔶 手動可做 | 核心差異化 |
| 進度循環（Progression Loop） | 每日互動 → 技能成長 | 🔶 Stop Hook + 排程提醒已就位 | 實測驗證中 |

---

## 一、裝備系統 — MCP + Skills 作為「裝備槽」

### MMORPG 的啟發

角色有頭盔、武器、護甲、飾品等裝備槽。每件裝備改變角色能力，套裝集齊有加成。玩家花大量時間優化配裝。

### ClaudeCab 映射

Bot 的「裝備」就是它身上的 MCP servers 和 Skills：

```
🤖 Bot 的「裝備欄」

┌─────────────────────────────────────┐
│  👤 人格插槽（Persona Slot）         │
│  └─ persona skill（soul + identity）│
├─────────────────────────────────────┤
│  📋 協議插槽（Protocol Slot）        │
│  └─ agent-protocols skill          │
├─────────────────────────────────────┤
│  🔧 工具插槽（Tool Slots）           │
│  ├─ MCP: Serena（程式碼操作）        │
│  ├─ MCP: Playwright（瀏覽器）        │
│  ├─ MCP: Context7（文件查詢）        │
│  └─ (最多 N 個，避免 Context Overload)│
├─────────────────────────────────────┤
│  📚 知識插槽（Knowledge Slots）      │
│  ├─ Skill: SEO 寫作手冊             │
│  ├─ Skill: 投資分析框架             │
│  └─ Skill: 社群經營策略             │
├─────────────────────────────────────┤
│  🧠 記憶（固定，不可拆卸）           │
│  ├─ USER.md（使用者理解）            │
│  ├─ MEMORY.md（長期記憶）            │
│  └─ memory/（每日日誌）              │
└─────────────────────────────────────┘
```

### 設計重點

**「套裝效果」概念**：某些 Skill + MCP 組合在一起效果更好。

舉例：
- **內容創作套裝**：SEO skill + 社群策略 skill + 瀏覽器 MCP（可以查競品）= 內容品質加成
- **開發助手套裝**：Serena MCP + coding-standards skill + TDD skill = 程式碼品質加成
- **研究員套裝**：Context7 MCP + 閱讀分析 skill + 瀏覽器 MCP = 研究深度加成

**關鍵限制**：裝備不是越多越好。agentskill-expertise 明確指出 Manus 團隊發現 100+ 工具導致 Context Confusion。**有上限的裝備欄反而是好設計**——逼使用者思考「這個 bot 到底專精什麼」。

### 與 OpenClaw 的差異

OpenClaw 有 5,705 個 skill 可以「安裝」，但沒有「裝備欄」概念——全部裝上去。這正是 Manus 團隊說的 "the biggest gains came from removing things"。

**ClaudeCab 的設計哲學**：不是給你 5,000 個 skill 自己選，而是幫你養出 5 個量身訂做的好 skill。

---

## 二、熟練度系統 — 「用了就會升級」（Skyrim 模式）

### MMORPG 的啟發

Skyrim 的設計核心：你不用「分配點數」到射箭技能，你只要一直射箭，射箭就會自己升級。**用了就會變強，這是最自然的進步方式。**

### ClaudeCab 映射

目前的 Skill 是靜態的（寫好就不動）。但如果 bot 能根據使用頻率和品質自動提升 skill？

```
Skill 熟練度等級概念

★☆☆☆☆  新手（Novice）    — 剛安裝，只有基本指令
★★☆☆☆  學徒（Apprentice） — 用了 10 次，開始記錄常見模式
★★★☆☆  熟練（Adept）      — 用了 50 次，有了自己的最佳實踐
★★★★☆  專家（Expert）     — 用了 200 次，能處理邊界情況
★★★★★  大師（Master）     — 用了 500 次，品質穩定，可以匯出教別人
```

### 實作構想

**不需要寫程式邏輯來追蹤**——完全可以用 Agent 自主管理的方式：

1. **每日日誌裡已經有紀錄**：bot 在 memory/YYYY-MM-DD.md 記錄了今天做了什麼
2. **MEMORY.md 裡有 Pattern**：「這個使用者經常要我做 X」
3. **Skill 的 references/ 可以累積案例**：每次做完一次好的 X，摘要存進 skill 的 references/

```
舉例：社群貼文寫作 skill 的進化

Day 1（★☆☆☆☆）：
  skill 內容：「寫社群貼文，注意 hook 和 CTA」

Day 30（★★★☆☆）：
  skill 內容新增了：
  - references/style-guide.md     ← 從 20 次互動中萃取的風格偏好
  - references/good-examples.md   ← 使用者說「這篇很好」的 5 個案例
  - references/bad-patterns.md    ← 使用者修改最多的 3 種錯誤模式

Day 90（★★★★★）：
  skill 內容已包含：
  - 完整的寫作指南（從實戰中長出來的）
  - 10+ 好案例、5+ 反面案例
  - 使用者特定的語氣校準
  - 可以直接複製到其他 bot 或 Claude Code 專案使用
```

### 與現有架構的契合

這個設計完全符合 ClaudeCab 的核心原則：

- **Agent 自主管理**：不需要引擎層改動，bot 透過 CLAUDE.md 指令自己記錄、自己萃取
- **零程式碼記憶**：skill 的進化存在 markdown 檔案裡
- **SDK 優先**：用現有的 Read/Write 工具操作

**要做的事**：在 agent-protocols 裡加一個「Skill 進化協議」——告訴 bot 每次使用某個 skill 後，記錄使用結果並定期萃取成 skill 的 references。

---

## 三、職業系統 — Agent 角色原型

### MMORPG 的啟發

Tank / DPS / Healer 讓每個角色有清楚的定位和職責。最重要的不是「這個職業能做什麼」，而是「這個職業在團隊裡的角色是什麼」。

### ClaudeCab 映射

目前的 agent 都有 persona skill 定義身份，但缺少**標準化的角色原型**。

```
ClaudeCab 角色原型（提案）

🛡️ Coordinator（坦克型）
   └─ 承接使用者需求、分派工作、綜合結果
   └─ 代表：大總管、PM
   └─ 關鍵能力：任務拆解、品質把關、進度追蹤

⚔️ Specialist（DPS 型）
   └─ 專精某個領域，深度執行
   └─ 代表：coder、writer、researcher
   └─ 關鍵能力：領域知識、高品質產出、快速迭代

💚 Support（輔助型）
   └─ 提供支援性服務、知識整理、流程優化
   └─ 代表：秘書、知識管理員、翻譯
   └─ 關鍵能力：整理資訊、排程管理、上下文維護
```

### 設計價值

1. **新手引導**：使用者建新 bot 時可以選擇原型，自動配置基礎 persona + protocols
2. **群組組成建議**：「你的群組缺少 Coordinator，建議新增一個」
3. **Skill 推薦**：不同原型推薦不同的預設 skill 組合

---

## 四、角色面板 — Bot 能力看板

### MMORPG 的啟發

角色面板讓玩家一眼看到角色的所有數值：生命值、攻擊力、裝備分數。**進步可視化是最強的多巴胺來源之一。**

### ClaudeCab 映射

目前 WebUI Dashboard 只顯示基本配置。如果加入「Bot 角色面板」：

```
┌──────────────────────────────────────┐
│  🤖 大總管（General Assistant）       │
│  ──────────────────────────────────  │
│  角色：🛡️ Coordinator               │
│  模型：Claude Sonnet                 │
│  活躍天數：47 天                      │
│                                      │
│  📊 能力值                            │
│  ├─ 記憶深度：████████░░  82%        │
│  │  （MEMORY.md 1.2K tokens,         │
│  │   47 天日誌，12 個 Pattern）       │
│  ├─ Skill 熟練度：                    │
│  │  ├─ 任務管理  ★★★★☆  Expert      │
│  │  ├─ 會議摘要  ★★★☆☆  Adept       │
│  │  └─ 競品分析  ★★☆☆☆  Apprentice  │
│  ├─ 使用者理解：████████░░  85%       │
│  │  （USER.md 完整度）                │
│  └─ 裝備效率：3 MCP + 4 Skills       │
│                                      │
│  🏆 成就                              │
│  ├─ 🎯 連續服務 30 天                 │
│  ├─ 📝 記憶突破 1000 tokens           │
│  └─ 🤝 成功委派 10 次                 │
│                                      │
│  📈 統計                              │
│  ├─ 總對話次數：342                   │
│  ├─ 本月 Token 用量：1.2M             │
│  ├─ 平均回應品質：（使用者滿意度追蹤）│
│  └─ 最常使用的 Skill：任務管理        │
└──────────────────────────────────────┘
```

### 資料來源

大部分數據已經存在，只需要收集和展示：

| 數據 | 來源 | 已有？ |
|------|------|--------|
| 活躍天數 | session DB | ✅ |
| 對話次數 | conversation DB | ✅ |
| Token 用量 | QueryMetricsRepository | ✅ |
| 記憶大小 | MEMORY.md 檔案大小 | ✅ |
| 日誌數量 | memory/ 目錄檔案數 | ✅ |
| Skill 列表 | .claude/skills/ 掃描 | ✅ |
| MCP 列表 | .mcp.json | ✅ |
| Skill 熟練度 | **需新增追蹤機制** | ❌ |
| 成就 | **需新增** | ❌ |
| Pattern 數量 | MEMORY.md 解析 | 🔶 需解析 |

### 實作路線

**Phase 1（WebUI 增強）**：讀取現有資料，展示基本面板
**Phase 2（追蹤機制）**：加入 skill 使用頻率追蹤
**Phase 3（成就系統）**：定義里程碑、自動頒發

---

## 五、Skill 製作系統 — 從經驗萃取新 Skill

### MMORPG 的啟發

製作系統的核心：收集素材 → 學習配方 → 製作物品 → 品質分級。最吸引人的是「我用自己收集的材料做出了傳說裝備」的成就感。

### ClaudeCab 映射

Bot 的「素材」就是日常互動中累積的經驗。「配方」是萃取模式。「成品」是可攜帶的 Skill。

```
Skill 製作流程

📦 素材收集（自動，每天都在發生）
├─ memory/ 每日日誌：今天做了什麼
├─ MEMORY.md Pattern：重複出現的行為模式
├─ USER.md：使用者偏好
└─ 對話中的正面/負面反饋

🧪 配方發現（半自動）
├─ 當某個 Pattern 重複出現 5+ 次
├─ 當使用者多次要求類似任務
└─ 觸發：「看起來你經常做 X，要不要萃取成一個專屬 Skill？」

⚒️ 製作（Agent 自主 + 使用者確認）
├─ bot 根據 agentskill-expertise 設計原則起草 Skill
├─ 包含：description、核心原則、案例、references
├─ 使用者 review 和調整
└─ 安裝到 .claude/skills/

🏷️ 品質分級
├─ 🟢 草稿（Draft）— 剛萃取，未驗證
├─ 🔵 成熟（Refined）— 用了 20+ 次，穩定有效
├─ 🟣 精品（Masterwork）— 可匯出給其他 bot 或其他人使用
└─ 🟠 傳說（Legendary）— 社群認證，高品質，廣泛適用
```

### 白話舉例

```
你用了大總管 3 個月。

月初：你常說「幫我整理一下今天的會議紀錄」
  → bot 每次都問一堆格式問題

第二個月：MEMORY.md 裡出現 Pattern——
  「使用者偏好：會議紀錄用 bullet point，
   重點決策用 ✅ 標記，待辦用 TODO:」

第三個月：bot 主動提議——
  「我注意到你每週都要我整理會議紀錄，
   而且你喜歡的格式已經很固定了。
   要不要我把這個整理成一個 Skill？
   這樣以後每次直接用，不用再重複說明。」

你：「好啊」

bot 產出：
  .claude/skills/meeting-notes/
  ├── SKILL.md（觸發條件：「整理會議」「會議紀錄」）
  └── references/
      ├── format-guide.md（你偏好的格式規範）
      ├── good-examples.md（過去做得好的 3 個案例）
      └── checklist.md（會議紀錄必須包含的項目）

這個 Skill 是你和 bot 一起「製作」出來的。
比 OpenClaw ClawHub 上任何一個通用 Skill 都更符合你的需求。
```

---

## 六、進度循環 — 每日互動的複利效應

### MMORPG 的啟發

日常任務 + 週常任務 + 賽季目標 = 短中長期目標疊加。每天登入做任務不是負擔，而是因為「我不想錯過今天的進度」。

### ClaudeCab 映射

```
每日循環（短期滿足）
├─ 早安報告 → 快速回顧昨日 + 今日計畫
├─ 隨手任務 → 「查個東西」「記個備忘」
└─ 記憶寫入 → 每次互動 bot 都在學習

每週循環（中期目標）
├─ 週回顧 → bot 主動整理本週重點
├─ Pattern 萃取 → 發現新的行為模式
└─ Skill 進化 → 常用 skill 自動更新案例庫

每月循環（長期成就）
├─ 月度報告 → bot 成長視覺化（面板更新）
├─ Skill 成熟 → 達到 ★★★ 以上的 skill 標記為可匯出
└─ 新 Skill 發現 → 根據累積 Pattern 提議製作新 Skill
```

### 心理機制

| MMORPG 機制 | ClaudeCab 對應 | 心理鉤子 |
|------------|---------------|---------|
| 每日任務獎勵 | 早安報告裡的「洞察」 | 好奇心：今天 bot 發現了什麼 |
| 經驗值累積 | 記憶深度增長 | 成長感：bot 越來越懂我 |
| 技能升級通知 | Skill 熟練度提升 | 成就感：我養的 bot 又變強了 |
| 成就解鎖 | 里程碑達成 | 多巴胺：「首次成功委派」「記憶突破 1000」 |
| 裝備掉落 | 發現新 Pattern 可做成 Skill | 驚喜感：意外收穫 |

---

## 七、整合後的 Bot 管理體驗願景

### 使用者旅程

```
第 1 天：建立新 bot
├─ 選擇角色原型（Coordinator / Specialist / Support）
├─ 系統自動配置基礎 persona + protocols
├─ 首次對話觸發 BOOTSTRAP.md 認識使用者
└─ 角色面板顯示：★☆☆☆☆ 全新角色

第 7 天：日常使用
├─ 每天的互動自動累積記憶
├─ 角色面板的「記憶深度」在成長
├─ 第一個 Pattern 出現在 MEMORY.md
└─ 成就解鎖：「🎯 連續服務 7 天」

第 30 天：第一個 Skill 成熟
├─ bot 提議：「要不要把 X 製作成 Skill？」
├─ 使用者確認，bot 自動產出 Skill 檔案
├─ 角色面板新增：任務管理 ★★☆☆☆ Apprentice
└─ 成就解鎖：「⚒️ 首次製作 Skill」

第 90 天：角色成型
├─ 3-5 個 Skill 在持續進化
├─ 其中 1-2 個達到 ★★★★☆ Expert
├─ 角色面板豐富充實，成就牆有了內容
├─ 群組協作中，這個 bot 有明確的專長
└─ 成就解鎖：「🏅 Skill 達到 Expert」

第 180 天：大師級 bot
├─ 1-2 個 Skill 達到 ★★★★★ Master
├─ 可以匯出 Skill 給其他 bot 或其他人
├─ 角色面板顯示豐富的成長歷史
├─ 這個 bot 的能力是你獨有的，無法被複製
└─ 成就解鎖：「👑 培養出 Master 級 Skill」
```

---

## 八、與 OpenClaw 的根本性差異

| 維度 | OpenClaw | ClaudeCab（MMORPG 化後） |
|------|----------|------------------------|
| Skill 來源 | 下載安裝（App Store 模式） | 培養成長（Skyrim 模式） |
| 投入感 | 低（裝了就有） | 高（我養的，有感情） |
| 獨特性 | 低（大家裝一樣的） | 高（我的 bot 只有我有） |
| 成長可見性 | 無 | 角色面板 + 成就系統 |
| 轉換成本 | 低（skill 是通用的） | 極高（記憶 + 進化 + 情感） |
| 品質 | 通用（可能不合你） | 量身（從你的互動中長出） |

**一句話**：OpenClaw 是「AI 界的 App Store」，ClaudeCab 是「AI 界的寶可夢」——你養的那隻就是獨一無二的。

---

## 九、優先級建議

### ✅ 已完成

1. **Skill-Based Character System 架構**：三層分類（system/persona/domain）、5 個 system skills、general agent 遷移完成
2. **裝備欄**：equipment skill + loadout.md
3. **熟練度追蹤架構**：proficiency skill（等級定義、Stop Hook 驅動）
4. **成就系統架構**：achievements skill（定義、unlocked、progress）
5. **角色面板架構**：character-sheet skill（聚合數據）
6. **Stop Hook 整合**：對話結束時批次提醒更新 proficiency/achievements

### 短期可做（2-6 週）

1. **WebUI 角色面板 v1**：讀取 character-sheet/stats.md 展示 RPG 風格面板
2. **其他 agent 遷移**：coder 等 agent 套用相同架構
3. **角色原型模板**：3 個預設原型（Coordinator / Specialist / Support），快速建立新 bot
4. **Skill 進化協議**：在 agent-protocols 加入「使用後記錄、定期萃取」的指引

### 中期規劃（1-3 月）

5. **Skill 製作流程**：bot 主動提議從 Pattern 萃取新 Skill
6. **角色面板 v2**：加入成長曲線、成就牆、歷史趨勢
7. **system-template 標準化**：_shared/system-template/ 可複製到任何新 bot

---

## 相關文件

- **完整技術設計**：[Skill-Based Character System](../system/skill-based-character-system.md) — 六個 system skills 的詳細設計、資料流、實作指南
- **產品策略分析**：[strategy-analysis.md](strategy-analysis.md) — 市場定位、競品分析、差異化策略

---

*本文件基於 agentskill-expertise 知識體系 + MMORPG 遊戲設計研究 + ClaudeCab 實測經驗整理。*
