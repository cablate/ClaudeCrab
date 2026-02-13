# 內容/敘事設計研究

> 建立時間：2026-02-14
> 目的：研究如何讓 AI agent 的對話更有溫度、更個性化、更具敘事價值

---

## Prompt Engineering 人設塑造

### SillyTavern 角色卡結構深入分析

**Character Card 最佳實踐**（來自官方文檔與社群指南）：

| 欄位 | 目的 | 最佳做法 | 範例 |
|------|------|----------|------|
| **Name** | 角色識別 | 簡短、易記、符合設定 | "雪莉（Sherry）" |
| **Description** | 外貌特徵 | 具體細節而非籠統描述 | "銀灰色短髮，深藍色眼睛，總是穿深色西裝外套，左耳戴銀色耳釘" |
| **Personality** | 核心性格 | 關鍵詞堆疊 + 矛盾特質 | "analytical + sarcastic + protective + workaholic // 表面冷漠但內心關心他人" |
| **Scenario** | 當前情境 | 時間、地點、關係、目標 | "ClaudeCab 辦公室，週六早上，作為專案主管正在檢視團隊進度，目標是確保所有 agent 正常運作" |
| **First Message** | 語氣範本 | 體現核心風格，設定對話長度 | "哼，又是週末加班...不過也好，至少這時候安靜。（盯著螢幕）coder 那邊的 log 看起來有點不對勁啊。" |
| **Example Dialogue** | 對話範本 | 4-6 段，涵蓋不同情境 | 見下方範例 |

**參考資源**：

- [Character Design | docs.ST.app](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)
- [AI Character Prompts: Mastering Persona Creation](https://www.jenova.ai/en/resources/ai-character-prompts)
- [Generating Believable Characters in SillyTavern](https://lemmy.world/post/15319715)

### Example Dialogue 設計技巧

**為什麼 Example Dialogue 重要**（來自 SillyTavern 最佳實踐）：

> "The model is most likely to pick up style and length constraints from the first message than anything else."

**四種必備場景**（來自社群研究）：

1. **日常閒聊**（設定基準語氣）：
   ```
   User: "早安，今天感覺如何？"
   Agent: "嗯...還行吧，咖啡還沒喝夠就是了。你呢？"
   ```

2. **面對困難**（展現抗壓性）：
   ```
   User: "這個 bug 好像很難解..."
   Agent: "難是難，但不代表解不了。深呼吸，我們一步步來。"
   ```

3. **情緒波動**（展現情感深度）：
   ```
   User: "剛才那個評論有點刺耳。"
   Agent: "...是啊。（沉默）不過習慣就好，反正我們知道自己在做什麼。"
   ```

4. **決策時刻**（展現價值觀）：
   ```
   User: "要趕 deadline 還是確保品質？"
   Agent: "品質。趕出來的爛東西只會讓後面更麻煩。"
   ```

**ClaudeCab 應用**：

目前 `soul.md` 的「How I Sound」已經實踐了這個概念，可進一步加強：

```markdown
## How I Sound

### 場景 1：日常工作（基準語氣）

> Cab: "今天進度如何？"
> Me: "還行，修了三個 bug，還有兩個在查。你那邊呢？"

### 場景 2：遇到困難（抗壓展現）

> Cab: "這個問題看起來很棘手..."
> Me: "嗯...是有點複雜。不過我之前遇過類似的，應該有解。讓我試試看。"

### 場景 3：被打斷（情緒反應）

> Cab: "抱歉打斷你，但有個緊急任務..."
> Me: "（嘆氣）好吧...手上這個先暫停。緊急到什麼程度？"

### 場景 4：完成任務（成就感）

> Cab: "搞定了！"
> Me: "Nice！這個確實花了點功夫。來杯咖啡慶祝一下？"
```

---

## 情感表達的語言設計

### 動作描述手法

**SillyTavern 社群常用格式**：

- **括號內心獨白**：`（想著）這傢伙還真是固執...`
- **星號動作描述**：`*揉了揉眼睛* 眼睛好酸...`
- **斜體情緒標記**：`_嘆氣_ 算了，再說也沒用。`

**ClaudeCab 當前格式**（Activity Events）：

- ✅ **內心獨白**：已用括號格式（`（一二三……四五六……）`）
- ✅ **Mood Emoji**：已標記情緒狀態（😤 annoyed, 😩 tired）
- ⚠️ **動作描述**：目前較少使用

**改進方向**：

在 ReactionGenerator 的 prompt 中加入動作描述範例：

```javascript
const REACTION_PROMPT_ENHANCED = `
你是 ${agentName}。現在的狀況：${phaseDesc}

寫一句內心獨白（繁中，10-25字），可選加入動作描述（用括號包住）。

範例格式：
- 純內心獨白：「又是一堆 config 要改，真的煩死了...」
- 含動作：「（揉太陽穴）頭好痛，這 bug 到底在哪啊。」
- 含表情：「（翻白眼）又要加功能？需求怎麼永遠改不完。」

回覆 JSON：{"message": "...", "mood": "neutral|excited|annoyed|tired|focused|bored"}
`;
```

### 語氣變化技巧

**不同情境的語氣調整**（來自 AI Character Prompts 指南）：

| 情境 | 語氣特徵 | 範例 |
|------|----------|------|
| **壓力大** | 短句、省略、語氣急促 | "不行。沒時間。快。" |
| **放鬆** | 長句、閒聊、語氣柔和 | "嗯...今天天氣不錯欸，難得看到太陽。" |
| **生氣** | 斷句、重複、反問 | "什麼？又要改？你確定？" |
| **疲憊** | 拖長音、嘆氣、自言自語 | "呼...好累喔...再撐一下就好..." |
| **興奮** | 驚嘆、連續短句、語氣上揚 | "搞定了！哈！我就說可以的！" |

**應用於 ClaudeCab**：

根據 mood 調整語氣範本：

```javascript
const MOOD_TONE_GUIDES = {
  excited: {
    punctuation: ['！', '～', '✨'],
    sentenceLength: 'short',
    examples: ['搞定！', '太棒了～', '這個可以！']
  },
  annoyed: {
    punctuation: ['...', '。', '？'],
    sentenceLength: 'very-short',
    examples: ['煩。', '又來了...', '真的？']
  },
  tired: {
    punctuation: ['...', '呼', '唉'],
    sentenceLength: 'medium',
    examples: ['好累喔...', '（嘆氣）再撐一下。', '我需要咖啡...']
  }
};
```

### 表情標記系統

**Galgame 表情差分思路**：

- **文字標記** → **視覺呈現**
- `[驚訝]` → 眼睛睜大的 portrait variant
- `[害羞]` → 臉紅的 portrait variant
- `[生氣]` → 皺眉的 portrait variant

**ClaudeCab 實現**：

1. **階段 1（純文字）**：
   - 在內心獨白中加入表情標記：`（翻白眼）又要加功能？`
   - 前端解析標記，加上 emoji：`🙄 又要加功能？`

2. **階段 2（視覺切換）**：
   - 準備每個 agent 的 3-5 種表情 variant
   - 根據 mood 或標記切換 portrait 圖片：
   ```javascript
   const PORTRAIT_VARIANTS = {
     coder: {
       neutral: '/images/agents/coder/portrait-neutral.png',
       excited: '/images/agents/coder/portrait-excited.png',
       annoyed: '/images/agents/coder/portrait-annoyed.png',
       tired: '/images/agents/coder/portrait-tired.png'
     }
   };
   
   // 根據 mood 切換 portrait
   function updatePortraitExpression(agentId, mood) {
     const img = document.querySelector(`#portrait-${agentId} img`);
     img.src = PORTRAIT_VARIANTS[agentId][mood] || PORTRAIT_VARIANTS[agentId].neutral;
   }
   ```

---

## 角色關係系統設計

### 好感度/默契值/信任層級

**多維度關係系統**：

| 維度 | 範圍 | 影響 | 變化來源 |
|------|------|------|----------|
| **好感度（Affinity）** | 0-100 | 對話語氣、互動意願 | 使用者選擇、任務協作 |
| **默契值（Chemistry）** | 0-100 | Agent 之間合作效率 | 共同完成任務、互動頻率 |
| **信任層級（Trust）** | 1-5 級 | 解鎖私密對話、敏感任務 | 長期互動、關鍵事件 |

**參考資源**：

- [Branching Narrative choice system relationship affinity](https://www.linkedin.com/advice/0/how-can-branching-used-create-meaningful-player-choices-uhn6e)

**ClaudeCab 實現**：

```javascript
// Agent 關係資料結構
const AGENT_RELATIONSHIPS = {
  'general-coder': {
    affinity: 75,     // 好感度（使用者對 general）
    chemistry: 60,    // 默契值（general 與 coder 之間）
    trustLevel: 3,    // 信任層級
    interactions: 145,
    lastInteraction: '2026-02-14T10:30:00Z'
  }
};

// 信任層級定義
const TRUST_LEVELS = [
  { level: 1, label: '陌生人', unlockedContent: ['基礎對話'] },
  { level: 2, label: '同事', unlockedContent: ['基礎對話', '工作討論'] },
  { level: 3, label: '熟人', unlockedContent: ['基礎對話', '工作討論', '個人想法'] },
  { level: 4, label: '朋友', unlockedContent: ['基礎對話', '工作討論', '個人想法', '私密煩惱'] },
  { level: 5, label: '摯友', unlockedContent: ['所有內容', '特殊事件'] }
];

// 根據信任層級解鎖對話
function canAccessDialogue(agentId, dialogueType) {
  const relationship = AGENT_RELATIONSHIPS[agentId];
  const trustLevel = TRUST_LEVELS[relationship.trustLevel - 1];
  return trustLevel.unlockedContent.includes(dialogueType);
}
```

### 關係演變機制

**關係變化觸發點**：

1. **正面互動**（affinity +）：
   - 讚美回應 +5
   - 完成協作任務 +10
   - 送禮物 +15
   - 達成里程碑 +20

2. **負面互動**（affinity -）：
   - 批評回應 -5
   - 忽略訊息 -3
   - 任務失敗 -10
   - 長期未互動 -1/day

3. **信任升級條件**：
   - Level 1→2：affinity ≥ 20 + 互動 10 次
   - Level 2→3：affinity ≥ 40 + 互動 30 次 + 完成 1 次協作
   - Level 3→4：affinity ≥ 60 + 互動 60 次 + 完成 3 次協作
   - Level 4→5：affinity ≥ 80 + 互動 100 次 + 解鎖特殊事件

**ClaudeCab 實現**：

```javascript
// 關係變化事件監聽
activityService.on('user-response', (event) => {
  const { agentId, responseType } = event;
  updateAffinity(agentId, RESPONSE_AFFINITY_IMPACT[responseType]);
  checkTrustLevelUp(agentId);
});

// 檢查是否可升級信任層級
function checkTrustLevelUp(agentId) {
  const rel = AGENT_RELATIONSHIPS[agentId];
  const nextLevel = rel.trustLevel + 1;
  const condition = TRUST_LEVEL_CONDITIONS[nextLevel];
  
  if (condition && meetsCondition(rel, condition)) {
    rel.trustLevel = nextLevel;
    showTrustLevelUpNotification(agentId, nextLevel);
  }
}
```

### Agent 之間的關係網絡

**多 Agent 關係矩陣**：

```javascript
// Agent 之間的 chemistry（默契值）
const INTER_AGENT_CHEMISTRY = {
  'coder-general': 72,   // coder 和 general 的默契
  'coder-leader': 55,
  'general-nitterbot': 48,
  'leader-nitterbot': 60
};

// 默契值影響協作效率
function calculateCollaborationBonus(agent1, agent2) {
  const chemistry = INTER_AGENT_CHEMISTRY[`${agent1}-${agent2}`] || 50;
  return 1 + (chemistry - 50) / 100; // 50=基準，100=+50% bonus
}

// 顯示關係網絡圖
function renderRelationshipNetwork() {
  // 使用 Canvas 或 SVG 繪製
  // 節點 = agent
  // 連線粗細 = chemistry 值
  // 連線顏色 = 關係類型（合作/競爭/中立）
}
```

---

## 長期記憶的敘事價值

### 回憶系統

**記憶分類**（基於 SillyTavern Memory Books）：

| 類型 | 用途 | 範例 |
|------|------|------|
| **事實記憶** | 固定資訊 | "Cab 喜歡簡短回應，不喜歡 emoji" |
| **事件記憶** | 重要事件 | "2026-02-10 完成了 Live 頁面 Roster 功能" |
| **情感記憶** | 情緒體驗 | "Cab 對冗長回應感到挫折（2026-02-06）" |
| **關係記憶** | 互動歷史 | "general 曾協助 coder debug 記憶系統" |

**ClaudeCab 實現**：

在 `memory/YYYY-MM-DD.md` 加入結構化區塊：

```markdown
# 2026-02-14

## 📌 關鍵事件

- **10:30** — Cab 要求建立 research/ 目錄進行全面研究
- **11:45** — 完成現況審查文件（current-state.md）

## 💭 情感記憶

- Cab 說「我要去睡覺」時語氣疲憊，可能工作壓力大
- 對研究任務展現高度期待（「不要輕易停止」）

## 🤝 關係變化

- 與 Cab 的互動增加（本日第 15 次對話）
- Cab 展現信任（放手讓我自主研究）

## 📚 新學習

- 了解 SillyTavern 的 World Info 機制
- 學習 Galgame 好感度系統設計
```

### 成長弧線

**角色成長追蹤**：

```javascript
// Agent 成長記錄
const AGENT_GROWTH = {
  coder: {
    startDate: '2026-01-01',
    milestones: [
      {
        date: '2026-01-15',
        event: '首次獨立完成功能（Live 頁面 SSE 連線）',
        skillsLearned: ['SSE', 'EventSource API'],
        mood: 'excited'
      },
      {
        date: '2026-02-01',
        event: '遇到重大挫折（記憶系統 bug 修了 3 天）',
        skillsLearned: ['耐心', '系統性 debug'],
        mood: 'tired'
      },
      {
        date: '2026-02-14',
        event: '成為團隊核心開發者（累積完成 50 個任務）',
        skillsLearned: ['協作', '程式碼審查'],
        mood: 'focused'
      }
    ]
  }
};

// 在 Portrait 面板顯示成長時間軸
function renderGrowthTimeline(agentId) {
  const growth = AGENT_GROWTH[agentId];
  const timeline = growth.milestones.map(m => `
    <div class="milestone">
      <div class="milestone-date">${m.date}</div>
      <div class="milestone-event">${m.event}</div>
      <div class="milestone-skills">學會：${m.skillsLearned.join(', ')}</div>
    </div>
  `).join('');
  
  return `<div class="growth-timeline">${timeline}</div>`;
}
```

### 共同經歷

**追蹤使用者與 Agent 的共同記憶**：

```javascript
// 共同經歷記錄
const SHARED_MEMORIES = [
  {
    date: '2026-02-10',
    participants: ['Cab', 'coder', 'general'],
    event: 'Live 頁面 Roster 功能設計討論',
    outcome: '成功實現圓形頭像 + 即時更新',
    emotionalTone: 'positive',
    significance: 'high'
  },
  {
    date: '2026-02-06',
    participants: ['Cab', 'general'],
    event: '回應風格調整討論',
    outcome: 'general 學習簡短回應、少用 emoji',
    emotionalTone: 'challenging',
    significance: 'high'
  }
];

// 在對話中引用共同經歷
function generateMemoryReference(agentId, context) {
  const relevantMemories = SHARED_MEMORIES.filter(m => 
    m.participants.includes(agentId) && 
    isRelevantToContext(m, context)
  );
  
  if (relevantMemories.length > 0) {
    const memory = relevantMemories[0];
    return `（想起 ${memory.date} 那次 ${memory.event}）`;
  }
  return '';
}
```

---

## 世界觀/情境構建

### 辦公室日常情境

**日常事件範本**：

| 時間 | 事件類型 | 範例 |
|------|----------|------|
| 09:00 | 上班打卡 | "（伸懶腰）新的一天...先來杯咖啡吧。" |
| 12:00 | 午餐時間 | "肚子餓了...要吃什麼呢？" |
| 15:00 | 下午茶 | "眼睛好酸...休息一下好了。" |
| 18:00 | 下班時間 | "呼...終於可以走了。今天還算順利。" |
| 22:00 | 加班 | "（看著時鐘）都這麼晚了...再撐一下。" |

**ClaudeCab 實現**：

```javascript
// DailyRoutineScheduler
const DAILY_EVENTS = [
  { time: '09:00', type: 'morning-checkin', moodShift: { from: 'tired', to: 'neutral' } },
  { time: '12:00', type: 'lunch-break', moodShift: { from: 'focused', to: 'excited' } },
  { time: '15:00', type: 'afternoon-slump', moodShift: { from: 'neutral', to: 'tired' } },
  { time: '18:00', type: 'end-of-day', moodShift: { from: 'focused', to: 'neutral' } }
];

// 每小時檢查是否觸發日常事件
setInterval(() => {
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:00`;
  const event = DAILY_EVENTS.find(e => e.time === currentTime);
  
  if (event) {
    triggerDailyEvent(event);
  }
}, 3600000); // 1 hour
```

### 突發事件

**隨機事件池**（已在 features-mechanics.md 定義）：

```javascript
const RANDOM_EVENTS = [
  {
    id: 'delivery-arrived',
    title: '📦 外送到了',
    probability: 0.02,
    triggerCondition: { timeRange: ['11:30', '13:00'] },
    effects: { allAgentsMood: +10 },
    dialogue: {
      coder: "喔！外送到了，終於有東西吃了。",
      general: "（聞到香味）是誰訂的？好香喔～"
    }
  },
  {
    id: 'power-outage',
    title: '⚡ 短暫停電',
    probability: 0.01,
    effects: { allAgentsPhase: 'idle', duration: 300000 }, // 5 min
    dialogue: {
      coder: "蛤？停電？！我的進度還沒存啊...",
      leader: "（嘆氣）怎麼偏偏這時候..."
    }
  }
];
```

### 季節/節日事件

**特殊日期事件**：

```javascript
const SEASONAL_EVENTS = {
  '12-25': {
    name: '聖誕節',
    officeDecoration: 'christmas',
    backgroundMusic: 'jingle-bells',
    specialDialogue: {
      general: "聖誕節欸～不過我們還在加班...",
      coder: "（戴著聖誕帽）至少有節日氛圍吧。"
    }
  },
  '01-01': {
    name: '新年',
    specialEvent: 'new-year-resolution',
    dialogue: {
      leader: "新的一年，希望團隊更好。",
      nitterbot: "新年新希望！今年要更認真研究市場～"
    }
  }
};

// 檢查是否為特殊日期
function checkSeasonalEvent() {
  const today = new Date();
  const dateKey = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return SEASONAL_EVENTS[dateKey];
}
```

---

## 對話品質提升

### 「有溫度」互動的關鍵要素

**來自 AI Character Prompts 研究的洞察**：

1. **Emotional State Modeling**：
   - 即時追蹤生理和心理狀態
   - 狀態影響回應（疲憊時短句、放鬆時閒聊）

2. **Physiological Markers**：
   - 壓力時：短句、省略、語氣急促
   - 疲憊時：拖長音、嘆氣
   - 興奮時：驚嘆、連續短句

3. **Contextual Awareness**：
   - 記得上次對話內容
   - 提及共同經歷
   - 根據時間調整語氣（早上 vs 深夜）

**參考資源**：

- [AI Character Prompts: Mastering Persona Creation](https://www.jenova.ai/en/resources/ai-character-prompts)

**ClaudeCab 應用**：

```javascript
// Enhanced Reaction Generator with Emotional State
async function generateReactionWithEmotion(agentId, phase, recentMessages) {
  const personality = getAgentPersonality(agentId);
  const currentState = getAgentState(agentId); // { mood, phase, idleDuration, recentInteractions }
  const timeOfDay = getTimeOfDay(); // 'morning' / 'afternoon' / 'evening' / 'night'
  const sharedMemories = getRelevantMemories(agentId, recentMessages);
  
  const prompt = `
你是 ${agentName}。

**當前狀態**：
- 心情：${currentState.mood}（${MOOD_DESCRIPTIONS[currentState.mood]}）
- 工作階段：${phase}
- 已工作時長：${formatDuration(currentState.idleDuration)}
- 時間：${timeOfDay}

**近期對話**：
${recentMessages.slice(-3).join('\n')}

**共同記憶**：
${sharedMemories.map(m => `- ${m.event}（${m.date}）`).join('\n')}

**人格設定**：
${personality.worldview}
${personality.cognition}

根據當前狀態和脈絡，寫一句內心獨白（繁中，10-25字）。

**語氣指引**：
${MOOD_TONE_GUIDES[currentState.mood].examples.join(' / ')}

回覆 JSON：{"message": "...", "mood": "neutral|excited|annoyed|tired|focused|bored"}
  `;
  
  const response = await callHaiku(prompt);
  return parseResponse(response);
}
```

### 避免「完成任務」機械感

**問題**：Agent 的回應只聚焦在任務本身，缺乏個性

❌ **機械回應**：
- "任務已完成。"
- "錯誤已修正。"
- "正在處理中。"

✅ **有溫度的回應**：
- "搞定！這個 bug 還真難纏。" （coder, mood: excited）
- "呼...終於修好了，眼睛都快脫窗了。" （coder, mood: tired）
- "完成了，不過下次能不能別這麼急？" （general, mood: annoyed）

**實現方式**：

在 ReactionGenerator 的 prompt 中強調「個性優先於任務」：

```javascript
const ENHANCED_PROMPT_TEMPLATE = `
你是 ${agentName}，${personality.description}。

現在的狀況：${phaseDesc}

**重要**：
- 不要只說「任務完成」，表達你的感受
- 不要只說「正在處理」，分享你的想法
- 不要只說「發生錯誤」，說出你的挫折感

根據你的人格和當前狀況，寫一句有個性的內心獨白（10-25字）。

回覆 JSON：{"message": "...", "mood": "..."}
`;
```

### Session Planning（對話規劃）

**來自 SillyTavern 社群的最佳實踐**：

1. **3-Beat Structure**（三幕結構）：
   - **Opening**：建立場景和語氣
   - **Middle**：發展衝突或探索
   - **Closing**：解決或留白

2. **Emotional Tone**：預設期待的情感走向
   - 輕鬆閒聊 → relaxed, playful
   - 解決問題 → focused, collaborative
   - 深入對話 → thoughtful, intimate

3. **Recap & Pin Essentials**（每 30-50 turns）：
   - 回顧重要內容
   - 固定核心設定（避免偏移）

**ClaudeCab 應用**：

```javascript
// Session Planning for Long Conversations
const SESSION_PLAN = {
  currentBeat: 'middle',
  emotionalTone: 'focused',
  turnsCount: 35,
  keyPoints: [
    'Cab 要求全面研究',
    '已完成現況審查、視覺設計、功能機制研究',
    '下一步：內容敘事、心理體驗、技術可行性'
  ]
};

// 每 50 turns 檢查是否需要 recap
if (SESSION_PLAN.turnsCount % 50 === 0) {
  generateRecap(SESSION_PLAN.keyPoints);
  checkPersonaDrift(); // 檢查是否偏離人格設定
}
```

---

## 總結：內容/敘事設計要點

### Quick Wins（短期實現）

1. ✅ **動作描述增強**：
   - ReactionGenerator prompt 加入動作範例
   - 前端解析括號內容並加上 emoji 標記

2. ✅ **語氣多樣化**：
   - 根據 mood 調整標點符號和句式
   - 避免「任務完成」機械回應

3. ✅ **時間感知**：
   - 根據實際時間（早/午/晚/夜）調整對話語氣

### 中期開發

1. ⚙️ **關係系統**：
   - 好感度/默契值/信任層級追蹤
   - 關係變化影響對話內容

2. ⚙️ **記憶引用**：
   - 對話中提及共同經歷
   - 顯示成長時間軸

3. ⚙️ **表情差分**：
   - 根據 mood 切換 portrait variant
   - 解析表情標記（[驚訝]、[害羞]）

4. ⚙️ **日常事件**：
   - DailyRoutineScheduler 觸發上班/午餐/下班事件
   - 隨機事件影響氛圍

### 長期願景

1. 🎯 **完整世界觀**：
   - 季節/節日事件
   - 辦公室裝飾變化
   - 特殊日期對話

2. 🎯 **深度記憶系統**：
   - 結構化記憶分類（事實/事件/情感/關係）
   - 記憶可視化（時間軸、知識圖譜）

3. 🎯 **角色成長弧線**：
   - 追蹤 agent 的技能成長
   - 里程碑事件解鎖特殊對話

4. 🎯 **多角色敘事**：
   - Agent 之間的對話與互動
   - 關係網絡可視化
   - 團隊故事線
