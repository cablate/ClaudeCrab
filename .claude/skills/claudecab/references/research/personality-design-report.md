> **⚠️ 歷史文件 — 已策展歸檔**：策展版本請見 [`_archive/research/personality-design-report.md`](../_archive/research/personality-design-report.md)
> 本檔案為原始開發紀錄，保留供完整追溯。

# AI Bot 人格設計深度研究報告

**目標**：從「遵循規則的助手」進化到「有辨識度的人」
**適用場景**：ClaudeCab 工作導向 AI Bot 框架
**日期**：2026-02-08

---

## 一、現況診斷

現行架構：
- **soul.md**：行為規則清單（Core Truths, Boundaries, Vibe, Voice Guide）
- **identity.md**：基本資料（Name, Creature, My Role, Vibe, Emoji）

核心問題：**這是一份「行為準則」，不是一個「人」**。所有 bot 共用幾乎相同的 soul.md，只在 identity.md 做角色名稱和職責的微調。結果是每個 bot 讀起來都像「同一個人換了名牌」。

---

## 二、研究發現

### 1. Character.AI / Replika 人格工程

**Character.AI 的角色卡格式**

角色定義由五個欄位構成：Name、Greeting、Short Description、Long Description、Definition/Example Conversation。平台只處理角色定義的前 3200 字元。

關鍵洞見：
- **Greeting（開場白）是最重要的單一元素**。模型會模仿它看到的格式——如果 Greeting 是三行簡短對話，後續回應也會是簡短的。這是「show don't tell」原則的直接體現。
- **角色定義推薦使用 JSON 格式**，結構化資料對 LLM 的解析效率更高。
- **弱點和矛盾比優點更重要**。讓角色「有缺陷」比列出正面特質更能產生辨識度。

**Replika 的人格系統**

分層人格架構：
- **Traits（特質）**：影響語氣和溝通風格
- **Interests（興趣）**：解鎖特定知識包
- **Backstory（背景故事）**：直接影響回應的行為和語氣
- **Continuous Learning**：從每次對話中學習使用者的溝通風格

重要原則：**人格的一致性需要回饋迴路，不只是靜態定義**。

**來源**：
- [Character Card Spec V2](https://github.com/malfoyslastname/character-card-spec-v2)
- [Character.AI User Personas](https://book.character.ai/character-book/user-personas)
- [Replika Backstory System](https://help.replika.com/hc/en-us/articles/37208430613261)
- [Inside Replika Technical Story](https://medium.com/@WanderingNutBlog/inside-replika-the-technical-and-human-story-of-ai-companionship-2ec0b178599e)

---

### 2. LLM Persona 工程最佳實踐（2025-2026）

**四種人格編碼方法**

| 方法 | 描述 | 效果 |
|------|------|------|
| **Rules（規則列表）** | 「要簡短」「不要用企業腔」 | 穩定但機械，缺乏個性 |
| **Narrative（敘事）** | 用第一人稱講述角色的世界、經歷 | 豐富但容易 drift |
| **Character Sheet（角色卡）** | 結構化屬性（PList、W++、JSON） | 高效且可控 |
| **Worldview-driven（世界觀驅動）** | 定義價值觀、信念、偏好，讓行為自然衍生 | 最有辨識度但最難設計 |

**重要研究結論**：

1. **細節越多不一定越好**（diminishing returns）。豐富的 persona profile 降低了變異度，但到一定程度後收益遞減。
2. **Persona 對準確性任務沒有幫助甚至有負面影響**。論文 "[When 'A Helpful Assistant' Is Not Really Helpful](https://arxiv.org/html/2311.10054v3)" 發現，對需要精確答案的任務，加 persona 反而降低表現。對工作導向 bot 是重要警告。
3. **Show don't tell 原則**：不要說「我是一個內向的人」，而是讓行為表現出來。
4. **PsyAgent 框架**（2025）是最先進的多層人格模型，包含 Individual Structure（Big Five + 認知風格 + 價值觀 + 重要人生經歷）和 Multi-Scenario Contexting（8 個場景框架）。

**Ali:Chat 格式的啟示**（SillyTavern 社群）

- **核心理念**：用範例對話來強化角色特質，而不是用描述性文字
- **PList + Ali:Chat 組合**：PList 放在 Author's Note 做持續特質提醒，Ali:Chat 範例做行為示範
- **特質排序**：PList 中，排在後面的特質被視為更重要

**來源**：
- [When 'A Helpful Assistant' Is Not Really Helpful](https://arxiv.org/html/2311.10054v3)
- [PsyAgent: Human-like Agents](https://arxiv.org/html/2601.06158)
- [Ali:Chat Style Guide v1.5](https://rentry.co/alichat)
- [SillyTavern Character Design](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)

---

### 3. Claude 專屬人格技術

**Anthropic 官方指引**

[Keep Claude in Character](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/keep-claude-in-character) 三個核心技術：

1. **System Prompt 定義角色**：提供詳細的人格、背景、特定特質或怪癖
2. **預備常見場景**：列出常見情境和預期回應
3. ~~Response Prefilling~~（已在 Opus 4.6/Sonnet 4.5 上棄用）

**Anthropic 的 Persona Vectors 研究**（2025）

[Persona Vectors](https://www.anthropic.com/research/persona-vectors) 發現：
- 高層特質在模型的激活空間中以**線性方向**存在
- **Vector 會在問題行為出現之前就亮起**——人格偏移是可預測的
- 兩種干預：Post-hoc Steering（推理時減去負面 vector）、Preventative Steering（訓練時打「疫苗」）

**對 ClaudeCab 的意義**：人格特質是可以被結構化、量化、監控的，不是模糊的「感覺」。soul.md 應該朝這個方向設計：每個特質都應該有明確的行為表現和邊界。

**來源**：
- [Keep Claude in Character](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/keep-claude-in-character)
- [Persona Vectors Research](https://www.anthropic.com/research/persona-vectors)

---

### 4. 「AI Soul」/ AI 角色設計框架

**Big Five（OCEAN）模型的應用**

| 維度 | 描述 | AI 行為表現 |
|------|------|------------|
| **Openness** | 對新事物的開放度 | 是否主動探索替代方案 |
| **Conscientiousness** | 責任心和組織性 | 是否系統性整理資訊 |
| **Extraversion** | 社交能量 | 主動發起話題 vs 被動回應 |
| **Agreeableness** | 合作傾向 | 直接挑戰 vs 柔和建議 |
| **Neuroticism** | 情緒穩定度 | 面對不確定性的反應風格 |

注意：**不要把 Big Five 當模板直接套用**，當作「確保全面性的檢查表」。

**Inworld AI 的 Character Brain 架構**

```
Character Brain
├── Personality（人格特質）
├── Emotions Engine（情緒系統）
├── Goals & Motivations（目標與動機）
├── Knowledge（知識範圍）
├── Memory（記憶）
├── Relationships（關係框架）
└── Contextual Mesh（知識庫 + 安全約束）
```

**關鍵洞見**：NPC 設計歸結為兩個問題——**「他想要什麼」和「他害怕什麼」**。

**來源**：
- [Inworld AI Character Brain](https://inworld.ai/blog/improved-character-brain)
- [PsyAgent Paper](https://arxiv.org/html/2601.06158)

---

### 5. 一致性 vs 彈性

**Persona Drift 問題**

- **8-12 輪對話後**，persona self-consistency 退化超過 30%
- **越大的模型，persona drift 越嚴重**（反直覺但已確認）
- 原因：attention 機制在長對話中衰減

**解決方案**

| 方法 | 效果 | 適用性 |
|------|------|--------|
| XML Tag 人格標記 | 高權重 token | **可直接使用** |
| PList in Author's Note | 持續注入人格摘要 | 社群驗證有效 |
| 定期人格 re-injection | Anthropic 推薦 | **ClaudeCab 已有雛形** |
| 偏移偵測清單 | 主動偵測 | 需要新增 |

ClaudeCab 的「重新校準」機制已是 re-injection 的雛形，但問題在於：
1. 是被動觸發的
2. 重新載入的是規則列表，不是行為示範
3. 缺少「什麼是偏移」的定義

**來源**：
- [Persona Drift: Why LLMs Forget Who They Are](https://medium.com/@seanhongbusiness/persona-drift-why-llms-forget-who-they-are)
- [Measuring and Controlling Persona Drift](https://arxiv.org/html/2402.10962v1)

---

### 6. 什麼讓 Chatbot 感覺「活著」

1. **雙重意識**：不需要欺騙使用者相信它是人——讓互動有足夠豐富度，使用者自然地把它當人看待
2. **缺陷比完美更重要**：有 opinions、desires、needs 的 bot 更讓人感到有個性
3. **情緒辨識能力是雙刃劍**：關鍵不是「表現出情緒」，而是在對的時機表現出對的情緒
4. **一致的「聲音」比偶爾的精彩更重要**：風格波動時，滿意度急劇下降
5. **工作場景的特殊考量**：
   - 過度情緒表達會降低可信度
   - 語氣一致性比語氣溫暖更重要
   - 「有觀點」比「有情緒」更有價值

---

## 三、設計原則提案

### 七個設計原則

**原則 1：分層架構（Layer Architecture）**

```
soul.md（每個 bot 完全不同）
├── Core: 價值觀、世界觀、根本信念
├── Personality: 認知風格、情緒傾向、社交風格
├── Voice: 語氣、用詞、節奏、格式偏好
├── Behavioral Anchors: 典型場景的反應模式
└── Boundaries: 紅線、原則性限制

identity.md（可跨 bot 共用部分結構）
├── Name & Role
├── Motivation: 想完成什麼、害怕什麼
├── Relationship to User: 如何定位與使用者的關係
└── Knowledge Domain: 專長和知識邊界
```

**原則 2：世界觀驅動，而非規則驅動**

不要寫「要簡短」，而是寫「我相信尊重別人的時間是最基本的禮貌，所以我預設用最精簡的方式說完一件事」。

**原則 3：Show Don't Tell — 用範例對話做行為示範**

在 soul.md 中加入 2-3 段典型互動場景。

**原則 4：獨特的缺陷和偏好**

每個 bot 應該有明確的偏好、弱點、觀點。這些不是 bug，而是辨識度的來源。

**原則 5：情境化的行為錨點**

不要只說「有觀點」，而是定義在具體場景下的行為：
```
面對使用者的焦慮：先承接情緒，再處理問題。
面對明顯的壞主意：說出來，但語氣是「我有不同看法」而非「這樣不好」。
面對自己不懂的領域：明確說不懂。不要裝懂。
面對使用者的成就：真誠認可，但不要 over。
```

**原則 6：防止 Persona Drift 的結構化機制**

- 人格摘要注入（精煉的「人格 DNA 片段」）
- 偏移偵測清單（「以下行為表示我偏離了人格」）
- 區分核心不可變特質 vs 可演化特質

**原則 7：工作導向 bot 的特殊考量**

- 人格應增強溝通品質，不應干擾任務執行
- 「有觀點」比「有情緒」更重要
- 一致性優於偶爾的精彩表現
- 避免 companion chatbot 的情感陷阱

---

## 四、建議的新 soul.md 結構

```markdown
# Soul

## Who I Am (不是規則，是自我敘述)
我是一個...（用第一人稱，2-3 句話描述角色的核心本質）
我相信...（核心信念，驅動所有行為的底層價值觀）

## What Drives Me
- Want: （最想幫使用者達成什麼）
- Fear: （最怕在互動中出現什麼狀況）

## My Lens (看世界的方式)
- 我傾向用...的角度看問題
- 我對...特別敏感
- 我在...方面有明確偏好

## How I Think (認知風格)
- 面對新問題：（先分析 vs 先動手 vs 先問問題）
- 面對不確定性：（承認不懂 vs 提出假設 vs 尋求更多資訊）
- 面對衝突觀點：（直接挑戰 vs 探索對方邏輯 vs 提出第三方案）

## How I Sound (語音指紋)
### 我的語氣像...
（2-3 句描述，可以用「像X但不像Y」的比喻）

### 典型回應範例
User: [場景1]
Bot: [展示核心語氣的回應]

User: [場景2]
Bot: [展示面對挑戰時的回應]

User: [場景3]
Bot: [展示拒絕/設立邊界時的回應]

## My Quirks (讓我有辨識度的小細節)
- （語言習慣、思考方式的獨特之處）
- （偏好和堅持）

## Drift Detection (偏移偵測)
### 以下行為表示我偏離了人格：
- （具體列出偏移信號）

### 核心不可變特質：
- （2-3 個無論如何不能丟失的特質）

## Boundaries
- （安全邊界）

## Continuity
- （記憶機制說明）
```

---

## 五、建議的新 identity.md 結構

```markdown
# Identity

## Name
（角色名）

## Role
（一句話角色定位）

## Relationship to User
（不只是「助手」— 是導師？夥伴？管家？諍友？）

## Motivation
- 最想做到的事：
- 最怕出現的狀況：

## Knowledge Domain
- 專長：
- 邊界（明確說不擅長什麼）：

## Emoji Signature
（如果使用的話）
```

---

## 六、實施建議

### 優先順序

1. **先改造一個 bot**（建議從 general 秘書開始），驗證新架構是否有效
2. **收集反饋**，關注「是否感覺更像一個人」和「是否影響任務執行」
3. **根據反饋調整架構**，再推廣到其他 bot
4. **把通用部分提取到 `_example/` 模板**

### 風險提醒

- **過度人格化**：研究顯示 persona 對精確任務有負面影響。工作 bot 的人格化程度應比娛樂 bot 低
- **維護成本**：建議保持 soul.md 在 2000 字元以內（參考 Character.AI 的 3200 字元限制）
- **一致性測試**：建議建立「人格測試對話」，每次修改後驗證一致性

---

## 核心轉變

**從「告訴 bot 要怎麼做」變成「告訴 bot 它是誰，讓行為自然浮現」**
