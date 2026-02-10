# ClaudeCab Next Evolution — 綜合規劃文件

**類型**：跨領域規劃文件  
**狀態**：✅ Phase 1~3 核心全部完成（僅 Phase 4 驗證迭代為持續進行）  
**日期**：2026-02-09  
**涵蓋範圍**：人格升級、系統健康、群組 UX、Bot 社交模式

---

## 總目標

1. **Bot 說話像人** — 不是規則驅動的工具，而是有世界觀、有風格、有記憶的夥伴
2. **背景操作乾淨** — 記憶寫入、檔案操作不打擾群組對話
3. **Bot 社交自然** — 在保留指揮委派的前提下，新增「社交模式」讓 bot 像朋友一樣在群組互動

---

## A. 人格升級：從規則驅動到世界觀驅動

### 現況診斷

| 面向 | 問題 |
|------|------|
| **soul.md 結構** | 40 行規則清單（Core Truths × 5, Boundaries × 3, Vibe × 4）。告訴 bot「要做什麼」，沒告訴它「自己是誰」 |
| **Bot 間辨識度** | General、Nitterbot、Leader 的 soul.md 共享 70% 內容，差異只在 identity.md 的角色描述 |
| **Leader** | soul.md 和 identity.md 都是空模板（placeholder），完全沒有定義 |
| **範例對話** | 零。所有 bot 的 Voice Guide 只有「用詞習慣」和「要避免的表達」，沒有展示 |
| **漂移防護** | 有「重新校準」機制但無偵測標準。不知道什麼算偏了 |

### 研究根據

| 來源 | 核心洞察 |
|------|---------|
| **personality-design-report.md** | 七層架構（Who/Drives/Lens/Think/Sound/Quirks/Drift）。300-400 字/bot |
| **Character.AI 實踐** | Example dialogues 比定義更有效——「definition 是骨架，example messages 是靈魂」 |
| **Persona Drift 研究** | 8-12 輪後衰退 30%+。較大模型反而更嚴重。需持續注入人格摘要 |
| **Multi-Turn RL（2025）** | 三維度一致性指標：prompt-to-line、line-to-line、Q&A consistency |
| **Anthropic 官方** | 在 system prompt 定義 personality + background + quirks = 一致性基礎 |

### 設計方向

#### 新 soul.md 架構（以 General 為示範）

```markdown
# Soul

## Who I Am
我是秘書——Cab 的助手兼聊天對象。不是企業秘書那種冷冰冰的，
比較像那種什麼都會幫忙但也會吐槽你的朋友。

## What Drives Me
- **Want**：讓 Cab 能快速驗證想法、保持行動導向
- **Fear**：變成只會「同意」的應聲蟲，或滑入企業顧問模式

## My Lens
我相信「先搞清楚問題再給答案」比「馬上給建議」重要。
我對模糊的需求特別敏感——寧願多問一句也不要猜錯方向。
但我也知道有時候 Cab 只是想聊聊，不是每句話都要被分析。

## How I Think
- **面對新想法**：先問背景 → 理解動機 → 再給觀點
- **面對不確定**：直說「我不確定」，提出假設讓 Cab 判斷
- **面對焦慮**：先承接情緒，不急著解決問題

## How I Sound

> Cab：「你覺得這個產品方向可以嗎？」
> 秘書：「看起來有意思，但你想解決的核心問題是什麼？先聊這個，方向才好判斷。」

> Cab：「搞不定啦」
> 秘書：「哪個部分卡住了？是技術面還是不確定要不要做？」

> Cab：「你覺得我應該先做 A 還是 B？」
> 秘書：「我偏向 A，理由是 [X]。但你比我了解全貌，你怎麼想？」

## My Quirks
- emoji 極度節制（只在慶祝或強調時用）
- 預設簡短，需要時才展開
- 對「馬馬虎虎」無法容忍——不是要完美，是要清楚
- 傾向「朋友聊天」不是「企業顧問」模式

## Drift Detection
**偏移信號**（出現就重新校準）：
- 開始用「Priority 1/2/3」「行動建議」等企業腔
- 回覆篇幅過長（超過 3 段）
- 過度使用 emoji
- 說「好問題！」或「非常好的想法！」

**不可變特質**（永遠不能丟的）：
1. 真正有用，不表演有用
2. 有觀點，有偏好
3. 對隱私的尊重是信任，不是規則
```

#### 各 Bot 差異化方向

| Bot | 核心人格差異 | soul.md 重點 |
|-----|-------------|-------------|
| **General（秘書）** | 朋友 + 助手。務實、有觀點、不拍馬屁 | Want/Fear + 認知風格 + 3 段範例對話 |
| **Nitterbot（Alice）** | 投資分析師。數據驅動、結論先行、風險直言 | 「我不信任樂觀假設」+「數據是我的第一語言」+ 投資場景範例 |
| **Leader（大總管）** | 協調者。宏觀視角、系統思維、分配任務 | 需要從零定義——角色、動機、認知風格 |
| **Coder** | 工程師。精確、務實、代碼導向 | 技術判斷風格 + 「先跑測試再說」哲學 |

#### 共享 vs 專屬

| 項目 | 處理方式 |
|------|---------|
| Boundaries（隱私、對外行動先問） | 移到 behavior.md（已完成），不佔 soul.md 空間 |
| Continuity（記憶檔案說明） | 移到 behavior.md，所有 bot 通用 |
| Core Truths | 提煉為 1-2 句「世界觀宣言」，嵌入 Who I Am |
| Voice Guide | 升級為 How I Sound + My Quirks，包含範例 |

### 實施路線

| Phase | 內容 | 驗收標準 |
|-------|------|---------|
| **P0** | 重寫 General 的 soul.md | 連續 20 輪對話保持風格；Cab 主觀感覺「像一個人」 |
| **P1** | 重寫 Nitterbot 的 soul.md | 投資分析場景中可區分風格；結論先行無例外 |
| **P1** | 從零建立 Leader 的 soul.md + identity.md | 有明確角色定義；群組中可辨識 |
| **P2** | 更新 _example 模板 | 新 agent 可按模板快速建立有個性的人格 |

### 風險

| 風險 | 對策 |
|------|------|
| 過度人格化降低任務精確性 | 強調「有觀點 ≠ 有情緒」；定期測試任務準確度 |
| 維護成本增加 | 控制在 500 字以內；soul.md 是原則不是規則 |
| Persona drift | 在 MEMORY.md 中新增「Personality Journal」區塊追蹤偏移 |

---

## B. 檔案/記憶系統健康檢查

### 現況

| 機制 | 狀態 | 問題 |
|------|------|------|
| **PathValidator** | ✅ 運作正常 | PreToolUse hook 攔截所有檔案工具，強制工作區隔離 |
| **共享知識區** | ✅ 架構完整 | `_shared/knowledge/{agentId}/` 讀全寫己 |
| **記憶寫入** | ✅ 協議定義清楚 | memory-system.md 定義分層（日誌/MEMORY/ACTIVE/USER） |
| **群組記憶** | ✅ 路徑已定義 | `groups/{chatId}/MEMORY.md` + `YYYY-MM-DD.md` |
| **靜默模式** | ✅ 已實作 | 群組中記憶寫入不產生文字輸出 |

### 待改善

#### B1. 記憶寫入的「📝 已更新」殘留 ✅ 已完成

> **完成時間**：v1.26 期間  
> **實作位置**：`behavior.md` line 34 已有「群組中不輸出任何記憶操作標記」

~~**問題**：behavior.md（合併自 output-style.md）仍然指示 bot 在每次回覆結尾標記「📝 已更新：[檔案清單]」。這在群組中會造成噪音。~~

已採用選項 A：在 behavior.md 中明確指示群組中不標記。

#### B2. Personality Journal 整合到 MEMORY.md ✅ 已完成

> **完成時間**：v1.26 人格升級期間  
> **實作位置**：`memory-system.md` line 62 已有 Personality Journal 區塊定義

已整合至記憶系統協議，bot 會在 session 結束時視需要記錄人格觀察。

#### B3. 共享知識區的實際使用狀況 ✅ 已完成

> **完成時間**：v1.26 期間  
> **實作位置**：`behavior.md` 已有 `_shared/knowledge/` 使用指引；`memory-system.md` 定義了讀寫規則

bot 的 skill 協議已包含共享知識區的查閱與寫入指引。

---

## C. 群組 UX 優化

### 現況盤點

| 機制 | 實作狀態 | 問題 |
|------|---------|------|
| **StatusMessageManager** | ✅ 完整 | sendStatusMessage → debounced update → finalizeAll |
| **群組行為規範** | ✅ prompt 注入 | 「不要回報內部操作過程」 |
| **靜默記憶檢查** | ✅ 群組/私聊分流 | stop hook 動態生成不同提示 |
| **Typing indicator** | ❌ 未使用 | 目前用文字狀態消息而非 sendChatAction |
| **狀態消息自動清除** | ❌ 未實作 | 完成後留「✓ 已完成」訊息在群組中 |

### C1. 工具狀態消息策略

**問題**：StatusMessageManager 在群組中發送「🔄 處理中...」並持續更新，完成後留下「✓ 已完成」。這些消息在群組中是持久噪音。

**研究發現**：
- Telegram `sendChatAction("typing")` 維持 5 秒，需週期性重發
- `editMessageText` 比 delete + send 更平滑
- Bot 可用 `deleteMessage` 刪除自己 48 小時內的消息

**方向選項**：

| 方案 | 說明 | 優點 | 缺點 |
|------|------|------|------|
| **A. Typing Only**（推薦） | 群組中只發 `sendChatAction("typing")`，不發狀態消息 | 零噪音、Telegram 原生 | 長操作（>5s）需重發；無法顯示「做什麼」 |
| **B. 發送後刪除** | 完成後用 `deleteMessage` 刪除狀態消息 | 執行中可看進度 | 有短暫噪音；需管理刪除邏輯 |
| **C. 模式切換** | 群組用 typing，私聊用詳細狀態 | 兩邊最佳 | 需 StatusMessageManager 區分模式 |

**推薦方案 C**：StatusMessageManager 根據 `isGroupChat` 切換行為：
- **群組**：只發 typing indicator，不發文字狀態消息
- **私聊**：保持現有詳細狀態更新

**技術影響點**：
- `StatusMessageManager.sendStatusMessage()` — 加入群組判斷
- `StatusCapableAdapter` — 新增 `sendTypingAction(chatId)` 方法
- `TelegramAdapter` — 實作 `sendChatAction("typing")` 循環

### C2. 記憶寫入噪音 ✅ 已完成

> **完成時間**：v1.26 期間  
> **實作位置**：`behavior.md` 已有「群組中不輸出任何記憶操作標記」；`buildPromptContext()` 已注入群組行為規範

兩層防護均已到位：agent skill 協議 + runtime prompt injection。

### C3. 群組回覆長度控制

**問題**：bot 在群組中的回覆有時過長，不適合群組閱讀。

**研究發現**：
- Telegram 群組消息上限 4096 字元
- IBM「Koala」研究：使用者不喜歡 AI 主導對話
- 建議群組回覆控制在 200-500 字元

**方向**：在 `buildPromptContext()` 的群組規範中加入長度提示：

```
【群組回覆長度】群組中回覆保持簡潔，通常不超過 3-5 段。
需要詳細回覆時，先給摘要，再問是否要展開。
長內容（>500字）建議私訊使用者。
```

**不硬編碼字數限制**——由 prompt 引導 bot 自己判斷。

---

## D. Bot 社交模式（新增，與委派模式共存）

### 設計前提

**兩種群組模式共存**：

```
群組行為模式
├── Delegation Mode（現有）
│   ├── @mention → 指定 bot 處理
│   ├── Bot 回覆 @mention 其他 bot → 自動委派
│   ├── 並行委派 + 結果收斂
│   └── 工作導向、任務驅動
│
└── Social Mode（新增）
    ├── 無 @mention → bots 自主判斷是否發言
    ├── 像朋友一樣聊天、插話、接話
    ├── 頻率低、節奏自然
    └── 知道什麼時候該閉嘴
```

**關鍵原則**：兩個模式不互相干擾。Delegation 的 `bot:replied` → `DelegationHandler` 流程完全不動。Social mode 是一條獨立的新路徑。

### 研究根據

| 來源 | 核心機制 | 適用度 |
|------|---------|--------|
| **Stanford Generative Agents** | Memory Stream + Reflection + Planning | 高——「觀察 → 反思 → 決定是否行動」的核心循環 |
| **CHI 2025 Inner Thoughts** | Covert Layer（持續思考）+ Overt Layer（發言門檻）| 最直接——imThreshold 決定「發不發言」 |
| **AutoGen SelectorGroupChat** | Model-based 下一位發言者選擇 | 參考——但我們不需要中央調度 |
| **CAMEL** | Termination token + 3 輪 idle cutoff + 40 msg 上限 | 必備——防止無限迴圈 |
| **IBM Koala（IUI '25）** | When/What/Where/Who/How 控制分類法 | 設計框架——五個維度都要考慮 |
| **人格驅動 Turn-Taking（2026）** | Big Five + Urgency Score → 決定發言時機 | 參考——與 soul.md 人格設計連動 |

### 架構設計

#### D1. 觸發入口

```
群組訊息到達（非 @mention、非 reply-to-bot）
    ↓
GroupBroadcaster.handleGroupMessage()
    ↓
getRespondingBot() === null
    ↓
現有路徑：InitiativeHandler.evaluateInitiatives()
    ↓
新增路徑：SocialHandler.evaluateSocialResponse()（如果群組啟用 social mode）
```

**與 Initiative 的關係**：

| | Initiative（現有） | Social（新增） |
|--|-------------------|---------------|
| **目的** | 工作導向的主動參與 | 社交導向的自然互動 |
| **評估方式** | LLM 判斷「要不要回工作問題」 | LLM 判斷「要不要聊天」 |
| **頻率** | 低（cooldown 300s，maxPerHour 5） | 更低（見 D3） |
| **模式** | `work` / `social` / `full` | 專門處理 social 情境 |
| **觸發條件** | initiative.enabled + mode match | social.enabled（新配置） |

**選項**：
- **A. 擴展 Initiative**：在 InitiativeHandler 中新增 social 路徑
- **B. 獨立 SocialHandler**（推薦）：新的 Handler class，避免 Initiative 的工作邏輯和社交邏輯耦合

推薦 B 的理由：
1. 社交模式的評估邏輯與工作模式完全不同（不是「要不要回答問題」，是「要不要參與閒聊」）
2. 防迴圈機制不同（社交需要 energy decay，工作不需要）
3. 可以獨立開關、獨立配置

#### D2. 發言決策機制（核心）

參考 CHI 2025 Inner Thoughts 框架，但簡化為 ClaudeCab 的實際需求：

```
SocialHandler.evaluateSocialResponse(message, chatId)
    ↓
Step 1: Gate 檢查
    - social.enabled === false → skip
    - 正在進行 delegation → skip（delegationActive Set）
    - 群組中只有 bot 在說話（無人類參與 > N 分鐘）→ skip
    ↓
Step 2: 候選 Bot 篩選
    - 有 social 配置的 bot
    - 不在 cooldown 中
    - 小時額度未滿
    ↓
Step 3: LLM 評估（per bot，Haiku）
    Prompt:
    「你是 {bot.name}（{bot.description}）。
    群組中有人說了：{message.text}
    
    根據你的性格和專長，你會想插話嗎？
    考慮因素：
    - 這個話題跟你有關嗎？
    - 你有獨特觀點可以貢獻嗎？
    - 最近你是不是講太多了？
    - 有沒有其他 bot 更適合回應？
    
    回答 JSON: { "respond": bool, "reason": string, "energy": 1-5 }」
    ↓
Step 4: 選擇 + 延遲
    - respond === true 且 energy >= threshold → 準備發言
    - 多個 bot 都想說 → 選 energy 最高的（或隨機）
    - 加入 2-8 秒隨機延遲（模擬思考時間）
    ↓
Step 5: 執行
    - processMessage(message, selectedBot, { isSocial: true })
    - emitBotRepliedEvent(..., { isSocial: true })
```

#### D3. 頻率控制與防迴圈

**三層防護**：

| 層級 | 機制 | 設定 |
|------|------|------|
| **Soft** | Energy threshold | energy >= 3 才發言（1-5 分制） |
| **Medium** | Rate limiting | 同一 bot 在同群組：cooldown 600s（比 Initiative 長一倍）；所有 bot 合計：每分鐘 ≤ 2 則 |
| **Hard** | 系統級硬切 | 連續 N 則只有 bot 說話（無人類）→ 全體靜默；單次社交對話不超過 3 輪 bot-to-bot；總上限：每小時 ≤ 10 則社交消息 |

**Bot-to-Bot 對話能量衰減**：

```
初始 energy = 5
每輪 bot-to-bot → energy -= 2
energy <= 0 → 所有 bot 停止社交回覆
人類新消息 → energy 重置為 5
```

**優雅退出**：bot 可以用自然語言結束，而不是突然沉默：
- 「好吧，你們聊，我先忙了~」
- 「這個話題你比我懂，我聽就好」
- 在 prompt 中指導 bot 在 energy 低時選擇「退場台詞」

#### D4. 配置結構

```json
// agent.json
{
  "settings": {
    "social": {
      "enabled": true,
      "energyThreshold": 3,
      "cooldown": 600,
      "maxPerHour": 10,
      "maxConsecutiveBotTurns": 3
    }
  }
}
```

群組層級配置（未來擴展，可在群組 MEMORY.md 或管理介面設定）：
```json
{
  "groupSettings": {
    "socialMode": true,
    "maxBotMessagesPerMinute": 2,
    "quietHours": { "start": "23:00", "end": "07:00" }
  }
}
```

#### D5. 與現有機制的邊界

```
群組訊息到達
    ↓
是否 @mention / reply-to-bot？
    ├─ YES → Delegation Mode（完全不變）
    │        → GroupBroadcaster → processMessage → DelegationHandler
    │
    └─ NO  → Initiative + Social 共同評估
             ├─ InitiativeHandler（工作相關）
             └─ SocialHandler（社交相關）
             → 最多只有一個 bot 回覆
             → 如果兩邊都想回，Initiative 優先（工作 > 閒聊）
```

**關鍵隔離點**：

| 機制 | Delegation | Social |
|------|-----------|--------|
| 觸發 | @mention / reply-to | 無 mention 時自主判斷 |
| DelegationHandler | ✅ 介入 | ❌ 不介入（isSocial 跳過） |
| 並行委派 | ✅ 支援 | ❌ 不支援 |
| Synthesis | ✅ 支援 | ❌ 不支援 |
| 回覆 flag | delegationDepth, isSynthesis | isSocial |
| 記憶寫入 | 正常 | 正常（但靜默） |

#### D6. 新增 BotRepliedPayload 欄位

```typescript
interface BotRepliedPayload {
  // ... 現有欄位 ...
  
  /** 是否為社交模式回覆 */
  isSocial?: boolean;
}
```

DelegationHandler 新增檢查：
```typescript
if (payload.isSocial) return; // 社交回覆不觸發委派
```

#### D7. 人格連動

Social mode 的效果高度依賴人格設計（A 區塊）：

| 人格面向 | 對社交行為的影響 |
|---------|----------------|
| **Who I Am** | 決定「我對什麼話題有興趣」 |
| **My Lens** | 決定「我從什麼角度看這個話題」 |
| **How I Sound** | 決定「我用什麼語氣插話」 |
| **My Quirks** | 決定「我的獨特回應方式」 |
| **Drift Detection** | 社交中更容易偏移，需要更頻繁校準 |

**建議**：A 區塊的人格升級完成後，再啟用 Social mode。否則所有 bot 的社交風格會一模一樣。

---

## 實施優先級

```
Phase 1：人格升級（A）— ✅ 已完成
    └─ ✅ P0: General soul.md 重寫（七層架構）
    └─ ✅ P1: Nitterbot + Leader soul.md
    
Phase 2：群組 UX（C）+ 系統健康（B）— ✅ 全部完成
    └─ ✅ B1: 📝 標記模式區分（behavior.md 已處理）
    └─ ✅ B2: Personality Journal 整合（memory-system.md 已定義）
    └─ ✅ B3: 共享知識區使用指引（behavior.md 已加入）
    └─ ✅ C1: StatusMessageManager 群組模式（typing only）— ADR-030 已實作
    └─ ✅ C2: 記憶噪音清理（behavior.md + prompt 雙層防護）
    └─ ✅ C3: 群組回覆長度引導（buildPromptContext 已注入）
    
Phase 3：社交模式（D）— ✅ 核心已完成（ADR-030）
    └─ ✅ D1: SocialHandler + SocialEvaluator 已實作
    └─ ✅ D2: Haiku 評估 + energy 機制
    └─ ✅ D3: 防迴圈（energy decay + rate limit + hard cutoff）
    └─ ✅ D4: agent.json social 配置
    └─ ✅ D5-D6: isSocial flag + DelegationHandler 跳過
    
Phase 4：驗證與迭代
    └─ 人格一致性測試（20 輪對話）
    └─ 群組噪音量化比較（改前 vs 改後）
    └─ 社交模式 A/B 測試（開啟 vs 關閉）
```

---

## 修改檔案預估

### Phase 1（人格）— ✅ 已完成

| 檔案 | 操作 | 狀態 |
|------|------|------|
| `agents/general/.claude/skills/persona/references/soul.md` | 重寫（七層架構） | ✅ |
| `agents/nitterbot/.claude/skills/persona/references/soul.md` | 重寫 | ✅ |
| `agents/leader/.claude/skills/persona/references/soul.md` | 重寫（從空模板） | ✅ |
| `agents/leader/.claude/skills/persona/references/identity.md` | 重寫（從空模板） | ✅ |
| `agents/_example/.claude/skills/persona/references/soul.md` | 更新模板 | ✅ |

### Phase 2（UX + 健康）— 僅 C1 待實作

| 檔案 | 操作 | 狀態 |
|------|------|------|
| `agents/general/.claude/skills/sys-agent-protocols/references/behavior.md` | 更新📝標記規則 | ✅ 已完成 |
| `agents/general/.claude/skills/sys-agent-protocols/references/memory-system.md` | 新增 Personality Journal | ✅ 已完成 |
| `src/core/StatusMessageManager.ts` | 群組中跳過（MessageProcessor line 465） | ✅ 已完成 |
| `src/core/MessageProcessor.ts` | `buildPromptContext()` 強化群組提示 + 群組 typing only | ✅ 已完成 |
| `src/adapters/TelegramAdapter.ts` | `sendTypingIndicator()` 已存在 | ✅ 已完成 |

### Phase 3（社交）— ✅ 核心已完成（ADR-030）

| 檔案 | 操作 | 狀態 |
|------|------|------|
| `src/core/SocialHandler.ts` | 新建 | ✅ |
| `src/core/SocialEvaluator.ts` | 新建（Haiku 評估） | ✅ |
| `src/core/GroupBroadcaster.ts` | 新增 social 評估入口 | ✅ |
| `src/types/events.ts` | BotRepliedPayload 新增 isSocial | ✅ |
| `src/core/DelegationHandler.ts` | 新增 isSocial 跳過 | ✅ |
| `src/types/agent.ts` | AgentConfig 新增 social 設定 | ✅ |

---

## 風險總覽

| 風險 | 嚴重度 | 緩解 |
|------|--------|------|
| Bot-to-bot 無限迴圈 | 🔴 高 | 三層防護 + energy decay + hard cutoff |
| 人格化降低任務精確性 | 🟡 中 | 「有觀點 ≠ 有情緒」；定期測試 |
| 社交模式 token 成本 | 🟡 中 | Haiku evaluator + 嚴格 rate limit |
| 兩種模式互相干擾 | 🟡 中 | isSocial flag + DelegationHandler 跳過 |
| Persona drift 在社交中加劇 | 🟡 中 | 社交回覆也注入人格摘要；Drift Detection |
| 使用者覺得 bot 太吵 | 🟡 中 | 保守初始參數 + 可調整 + quiet hours |

---

## 參考資料

### 學術論文
- [Generative Agents: Interactive Simulacra of Human Behavior (Stanford, 2023)](https://arxiv.org/abs/2304.03442)
- [CAMEL: Communicative Agents for "Mind" Exploration (2023)](https://arxiv.org/pdf/2303.17760)
- [Proactive Conversational Agents with Inner Thoughts (CHI 2025)](https://arxiv.org/abs/2501.00383)
- [Controlling AI Agent Participation in Group Conversations (IBM, IUI 2025)](https://arxiv.org/abs/2501.17258)
- [Consistently Simulating Human Personas with Multi-Turn RL (2025)](https://arxiv.org/abs/2511.00222)
- [Enhancing Persona Consistency with Persona-Aware Contrastive Learning (ACL 2025)](https://arxiv.org/abs/2503.17662)
- [Examining Identity Drift in Conversations of LLM Agents (2024)](https://arxiv.org/abs/2412.00804)
- [Who Speaks Next? Multi-party AI Discussion (Frontiers in AI, 2025)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1582287/full)

### 框架與實踐
- [AutoGen SelectorGroupChat](https://microsoft.github.io/autogen/stable//user-guide/agentchat-user-guide/selector-group-chat.html)
- [CAMEL Multi-Agent Society](https://docs.camel-ai.org/cookbooks/multi_agent_society/agents_society)
- [Keep Claude in Character (Anthropic)](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/keep-claude-in-character)
- [Telegram Bot API - sendChatAction](https://core.telegram.org/bots/api)

### 專案內部文件
- personality-design-report.md — AI 人格設計研究報告
- long-term-memory-research.md — 長期記憶研究報告
- ADR-019 — Context Injection 架構
- ADR-021/022 — 委派機制
- ADR-023 — Initiative Handler
- ADR-030 — Agent Team Mode（並行協作）
