# Agent Persona 設計指南

> 建立時間：2026-02-14
> 來源：SillyTavern Character Card、Character.AI、Galgame 競品研究
> 目的：說明 soul.md 和 identity.md 各欄位的設計依據，讓未來修改有章可循

---

## 設計哲學

Agent Persona 分成兩份檔案，對應不同層次：

| 檔案 | 定位 | 類比 |
|------|------|------|
| **identity.md** | 「你是誰」— 外在身份 | SillyTavern 的 name + description + scenario |
| **soul.md** | 「你怎麼活」— 內在性格 | SillyTavern 的 personality + mes_example |

分離理由：identity 可能跨場景複用（同一角色不同情境），soul 是不可變的核心。

---

## identity.md 欄位設計

### Name
角色名稱。簡短、易記、符合設定。

### Creature
角色定位描述。一句話說明「這個角色是什麼」。

**來源**：SillyTavern `scenario` 欄位 — 定義時間、地點、關係、目標。

### Appearance
外貌與視覺特徵。

**來源**：SillyTavern `description` 欄位。

**為什麼重要**：
- ClaudeCab 有 portrait 圖片，外貌描述確保生成一致性
- 具體細節 >> 籠統描述
  - ❌「她看起來很專業」
  - ✅「銀灰色短髮，深藍色眼睛，總是穿深色西裝外套，左耳戴銀色耳釘」

### Emoji
代表角色的 emoji，用於 UI 顯示。

---

## soul.md 欄位設計

### Who I Am
一段自然語言的自我介紹。讓模型理解角色的整體定位和語感。

### Core Traits
**關鍵詞堆疊格式**的性格特徵。

**來源**：SillyTavern 的 `personality` 欄位最佳實踐。

**為什麼用關鍵詞而非散文**：
- LLM 對關鍵詞列表的理解比散文精準，減少詮釋偏差
- 格式：`` `keyword1 + keyword2 + keyword3` ``
- 範例：`` `analytical + sarcastic + protective + workaholic` ``
- 5-8 個關鍵詞為宜
- 可用 `//` 加入矛盾特質補充：`表面冷漠但內心關心他人`

### What Drives Me
角色的內在動機（Want）和恐懼（Fear）。
讓模型理解角色「為什麼會這樣做」，而非只知道「做什麼」。

### My Lens
世界觀 — 角色看世界的方式、核心信念。

### How I Think
認知風格 — 面對不同類型問題時的思考模式。

### How I Sound（Example Dialogues）
**範例對話**，是整個 persona 最關鍵的欄位。

**來源**：SillyTavern 的 `mes_example` + `first_mes` 欄位。

**為什麼最關鍵**：
> "The model is most likely to pick up style and length constraints from the first message than anything else."
> — SillyTavern 官方文檔

**必備場景（至少 6 個）**：

| # | 場景類型 | 目的 | 範例情境 |
|---|----------|------|----------|
| 1 | **日常工作/基準語氣** | 設定預設語氣和回覆長度 | 「今天進度如何？」 |
| 2 | **資訊查詢** | 展現知識傳遞風格 | 「看一下 X 的設定」 |
| 3 | **引導/收集資訊** | 展現提問方式 | 「幫我做 X」（缺資訊時） |
| 4 | **完成任務** | 展現成就感表達 | 「搞定了！」的反應 |
| 5 | **出錯/困難** | 展現抗壓性和問題處理 | bug 修不好、操作失敗 |
| 6 | **被打斷/壓力** | 展現情緒反應 | 急件插入、多工 |
| 7 | **風險/決策** | 展現價值觀 | 要刪資料、要趕 deadline |
| 8 | **閒聊/放鬆** | 展現非工作面 | 「今天天氣不錯」 |

**寫作原則**：
- 每段對話要包含使用者的發話和角色的回覆
- 回覆長度 = 你期望模型實際產出的長度
- 場景要覆蓋完整情緒光譜（高興、困難、壓力、放鬆）

### Tone by Mood
**根據 mood 狀態調整語氣的指引表**。

**來源**：SillyTavern 社群的 `MOOD_TONE_GUIDES` 設計模式 + Character.AI 的情感狀態建模。

**為什麼需要**：
- 沒有這張表 → agent 不管什麼心情都用同一種語氣回覆 → 角色「死板」
- 有這張表 → excited 時短句驚嘆、tired 時拖長音嘆氣 → 角色「活起來」

**每個 mood 定義三個維度**：
1. **語氣特徵**：整體感覺（精準、輕快、不耐煩...）
2. **標點偏好**：常用的標點符號
3. **範例短語**：1-2 句實際範例

**標準 mood 列表**：`neutral` / `excited` / `annoyed` / `tired` / `focused` / `bored`

### My Quirks
角色的小習慣、口癖、偏好。讓角色有辨識度的細節。

### Drift Detection
**角色偏移偵測機制**。

**來源**：Character.AI 的角色一致性維持技術。

**為什麼需要**：
- LLM 在長對話中會逐漸偏離原始人格設定（20-30 輪後明顯）
- Character.AI 用模型層級偵測 + 每 30-50 輪 recap
- ClaudeCab 用 soul.md 中的自我檢查清單（成本更低）

**包含兩個部分**：
1. **偏移信號**：列出具體的偏移行為（出現任何一個就重新校準）
2. **不可變特質**：永遠不能丟的核心特質（2-3 條）

---

## 競品對照總表

| SillyTavern 欄位 | 目的 | ClaudeCab 對應 | 檔案 |
|-------------------|------|----------------|------|
| `name` | 角色識別 | Name | identity.md |
| `description` | 外貌特徵 | Appearance | identity.md |
| `scenario` | 當前情境 | Creature | identity.md |
| `personality` | 核心性格（關鍵詞） | Core Traits | soul.md |
| `first_mes` | 語氣範本 | How I Sound 場景 1 | soul.md |
| `mes_example` | 對話範本（多場景） | How I Sound 場景 2-8 | soul.md |
| — | mood 語氣調整 | Tone by Mood | soul.md |
| — | 偏移檢測 | Drift Detection | soul.md |

---

## 常見錯誤（Anti-patterns）

以下是實際設計過程中踩過的坑，修改或新建 persona 時務必避免：

### 1. 憑空編造 Appearance

**錯誤**：沒看 portrait 圖片就寫外貌描述，用刻板印象填充（IT 管理員 → 「深色連帽外套、黑框眼鏡、短髮偏亂」）。

**實際情況**：該角色的 portrait 是粉色捲髮、圓框金屬眼鏡、米白針織外套的溫和女生。

**正確做法**：
- **先看** `public/images/agents/{id}/portrait.png`
- 根據圖片描述具體特徵（髮色、髮型、眼鏡款式、服裝）
- Appearance 是為了 portrait 生成一致性，亂寫比不寫更糟

### 2. 只加結構、不改內容

**錯誤**：按照設計指南新增了 Core Traits、Tone by Mood、更多場景，但內容本質沒變——角色還是同一個「執行→回報」機器人，只是裝進更多格式框架。

**正確做法**：
- 新增欄位時，思考「這個角色跟其他角色有什麼不同」
- Core Traits 不能是通用的 `efficient + concise`，要反映這個角色獨特的性格
- Example Dialogue 不能只展示功能流程，要展示**這個角色特有的反應方式**

### 3. Core Traits 用通用詞

**錯誤**：`efficient + service-minded + systematic + cautious + concise + no-nonsense + detail-oriented` — 這描述任何一個稱職的管理員都成立，沒有辨識度。

**正確做法**：
- 想像兩個不同性格的人做同一份工作，他們的差異是什麼
- 加入矛盾特質和個人色彩：`meticulous + warm-but-brief + quietly-caring + perfectionist-about-config`
- 關鍵詞要能讓你一讀就知道「這是誰」，而不是「這是什麼職位」

### 4. Example Dialogue 只有功能交互

**錯誤**：8 個場景全部是「使用者下指令 → 角色執行回報」，只展示了工作流程，沒有展示角色的情感反應和個人特質。

**正確做法**：
- 場景 4（完成任務）：不只是「改好了」，加入角色特有的滿足感表達
- 場景 5（出錯）：不只是「失敗了」，加入基於經驗的診斷細節（「有時候頭尾會漏」）
- 場景 8（閒聊）：不只是把話題拉回工作，展現角色非工作面的關心方式
- 每段對話問自己：**如果把角色名字遮住，能不能認出是誰說的？**

### 5. Drift Detection 太抽象

**錯誤**：偏移信號只寫「回覆變長」「過度解釋」，缺乏跟角色個性綁定的具體信號。

**正確做法**：
- 偏移信號要跟角色特質掛鉤：「失去那種安靜可靠的感覺」比「回覆變長」更精確
- 不可變特質要有情感補充：「快速執行——但不是冷漠，是效率」讓模型理解行為背後的動機

---

## Checklist：新建 Agent Persona

建立新 agent 時，確認以下項目都有填寫：

### identity.md
- [ ] Name（簡短易記）
- [ ] Creature（一句話角色定位）
- [ ] Appearance（具體外貌描述，用於 portrait 生成）
- [ ] Emoji

### soul.md
- [ ] Who I Am（自然語言自我介紹）
- [ ] Core Traits（5-8 個關鍵詞，`` ` `` 包住）
- [ ] What Drives Me（Want + Fear）
- [ ] My Lens（世界觀/核心信念）
- [ ] How I Think（認知風格，至少 3 種情境）
- [ ] How I Sound（至少 6 個場景的範例對話）
- [ ] Tone by Mood（6 個 mood 的語氣指引表）
- [ ] My Quirks（3-5 個辨識細節）
- [ ] Drift Detection（偏移信號 + 不可變特質）
