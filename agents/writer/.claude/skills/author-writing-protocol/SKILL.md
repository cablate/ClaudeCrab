---
name: author-writing-protocol
description: |
  代替某位作者寫文章的通用寫作協議。每次需要「讓文字讀起來像某個特定的人寫的」時觸發。
  適用載體：部落格文章、電子報、社群貼文、社群長文，或任何有作者性質的文字產出。
  載入後提供：5步驟通用流程、作者參數讀取、各載體規範路由。
  架構：通用骨幹（SKILL.md）+ 作者參數層（author-profile.md + author-voice.md）+ 載體層（carrier-*.md）。
  換作者時只換參數層兩份文件，骨幹流程不動。
  主動更新時機：作者給出語氣/觀點的校正回饋時更新 references/author-voice.md；完成新載體類型且有教訓時新增 carrier-*.md。
---

# author-writing-protocol — 代替作者寫作的通用協議

## 概述

沒有這份 Skill，AI 寫出來的文字「技術上正確，但不像這個人寫的」——邏輯清晰、語氣中立、兩邊都說、不帶立場。有了這份 Skill，AI 從作者的世界觀出發，寫他會說的話、用他的判斷框架，交出讀起來像他寫的文字。

**唯一交付標準**：讀起來像作者本人寫的，不是「寫得不錯」。

---

## 核心原則

| 原則 | 為什麼 | ❌ vs ✅ |
|------|--------|---------|
| 世界觀先於技巧 | 技巧給句子，世界觀給聲音。從作者的角度思考，不是從客觀分析思考。 | ❌ 平衡報導各方觀點 → ✅ 從作者的核心信念出發 |
| 立場先於平衡 | 讀者來聽他怎麼想，不是看兩邊都對。 | ❌ 另一方面也有人認為... → ✅ 我看到的矛盾是... |
| 校準先於擴寫 | 角度錯了擴寫只是放大錯誤。 | ❌ 直接寫長文 → ✅ 300字先行，確認角度再長文 |
| 聲音是唯一標準 | 目標不是「寫得好」，是「像他寫的」。 | ❌ 邏輯清晰 → ✅ 像朋友在聊他的看法 |

---

## 通用 5 步驟流程

### Step 1：世界觀錨定

讀 `references/author-profile.md`，依照裡面指向的畫像路徑，重點看：
- **價值觀與信念**：他怎麼看這個世界、什麼讓他不爽、什麼讓他尊重
- **表達風格**：句式、節奏、比喻習慣、情緒表達方式
- **人格特質**：思考方式、判斷邏輯

目的不是「模仿他的句子」，而是「理解他為什麼會這樣想」。

接著讀 `references/author-voice.md` 補充協作層知識：實戰校正案例 + Pre-check 範例。

### Step 2：Pre-check

開始寫之前，宣告（如果作者在任務裡已附上則跳過）：

```
Core Persona：[一句話，誰在寫這篇]
Tone：[這篇的語氣基調]
```

### Step 3：短版先行

先寫 300 字社群貼文版本，讓作者校準角度。**目的是校準，不是交稿。**

### Step 4：迭代校準（預期 2-3 輪）

回饋通常落在三種：
- **角度不夠深**（你說的是表面，我想的是更深一層）
- **語氣不對**（太吐槽 / 太中立 / 太像 AI）
- **缺少核心矛盾**（作者看到的矛盾通常比第一直覺更深）

每次回饋後重寫，不是微調。角度錯了就換角度，不在錯的角度上打補丁。

### Step 5：擴寫長文

確認論點後才擴寫。擴寫原則：
- 保持同一個論點的自然展開，不加新觀點
- 段落之間是邏輯推進，不是並列堆砌
- 結尾要有力度——不是「總結」，是「最後一擊」

---

## 載體路由

確認載體後，在世界觀錨定之後追加讀取對應的 reference：

| 載體 | 追加讀取 | 特性 |
|------|---------|------|
| 電子報 | `references/carrier-newsletter.md` | 深度思考、多層次、朋友聊天感 |
| 部落格 | `references/carrier-blog.md` | 長文、SEO 意識、具體分析 |
| 社群貼文 | `references/carrier-social.md` | 快、輕、單一觀點、引發互動 |

沒有對應的 carrier reference？使用通用原則（Step 1-5）即可，不需強制套用。

---

## references/ 架構說明

**這個 Skill 的全部客製化都在 references/ 裡。** SKILL.md 本身不含任何作者資訊。

| 文件 | 放什麼 | 由誰填 |
|------|--------|--------|
| `author-profile.md` | 「這個作者是誰」——指向畫像文件路徑，或直接摘要關鍵維度（世界觀、風格、人格） | 初始化時填入 |
| `author-voice.md` | 「跟這個作者協作才得到的知識」——實戰校正案例、Pre-check 範例、實務規律。從空白開始，協作中累積 | 協作過程中逐步填 |
| `carrier-{name}.md` | 「這個載體的寫作規範」——結構、語調、格式、平台特定規則（如 SEO、發布流程）。按需新增 | 視載體需求新增 |

**模板**：
- `author-profile-template.md` → 複製為 `author-profile.md` 開始填
- `author-voice-template.md` → 複製為 `author-voice.md`（可先留空，協作中填入）

---

## 換作者初始化（三步驟）

**Step 1：建立作者畫像**
跑 `user-profiling` skill，從素材中提煉畫像，輸出到 `user-profiling/workspace/{name}.md`。

**Step 2：建立作者參數層**
```
cp references/author-profile-template.md references/author-profile.md
cp references/author-voice-template.md   references/author-voice.md
```
打開 `author-profile.md`，填入畫像文件路徑（或直接摘要關鍵維度）。
`author-voice.md` 第一次可以保持空白，協作過程中逐步填入。

**Step 3：開始使用**
直接觸發 `author-writing-protocol`，Step 1 會讀 `author-profile.md` 路由到畫像文件。

---

## 何時更新這份 Skill

| 情境 | 更新什麼 |
|------|----------|
| 作者對語氣/觀點給出校正回饋 | `references/author-voice.md` 的「實戰校正」區塊 |
| 完成新載體且有教訓 | 新增對應的 `carrier-{name}.md` |
| 核心原則需要調整 | SKILL.md「核心原則」區塊 |

---

## 參考資源

| 文件 | 內容 |
|------|------|
| `references/author-profile.md` | 當前作者的參數（指向畫像 + 聲音參考路徑） |
| `references/author-voice.md` | 協作層知識：實戰校正、Pre-check 範例、實務規律 |
| `references/author-profile-template.md` | 空白模板（初始化新作者用） |
| `references/author-voice-template.md` | 空白模板（初始化新作者用） |
| `references/carrier-template.md` | 空白模板（新增載體時複製） |
| `references/carrier-*.md` | 各載體的寫作規範（從 carrier-template.md 複製後填入） |
