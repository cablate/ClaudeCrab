# 功能/機制研究

> 建立時間：2026-02-14
> 目的：深入研究 SillyTavern、Character.AI、Galgame 的核心機制，萃取可應用元素

---

## SillyTavern 核心機制

### Character Card 格式

**Character Card 結構**（基於 TavernAI 規範）：

```json
{
  "name": "角色名",
  "description": "外貌描述（頭髮、眼睛、身高、穿著）",
  "personality": "性格特徵（MBTI、核心價值觀、行為模式）",
  "scenario": "當前情境（時間、地點、關係、目標）",
  "first_mes": "第一句對話（設定語氣和風格）",
  "mes_example": "範例對話（格式範本，用於引導 LLM）"
}
```

**關鍵設計洞察**（來自 SillyTavern 官方文檔）：

1. **描述要具體**：
   - ❌ "她很聰明" 
   - ✅ "她能在 3 秒內心算出三位數乘法，但記不住早餐吃了什麼"

2. **Personality 用關鍵詞堆疊**：
   - 格式：`keyword1 + keyword2 + keyword3`
   - 範例：`analytical + sarcastic + protective + workaholic`

3. **First Message 設定語氣**：
   - 模型最容易從第一句對話學習風格和長度
   - 第一句應該體現角色的核心特質

**參考資源**：

- [Character Design | docs.ST.app](https://docs.sillytavern.app/usage/core-concepts/characterdesign/)
- [Characters | docs.ST.app](https://docs.sillytavern.app/usage/characters/)

**應用於 ClaudeCab**：

ClaudeCab 的 `soul.md` 已經實踐了類似結構：

| SillyTavern | ClaudeCab | 對應檔案 |
|-------------|-----------|----------|
| `personality` | **世界觀** + **認知風格** | `soul.md` |
| `first_mes` | **範例對話** | `soul.md` |
| `name` | **Name** + **Creature** | `identity.md` |
| `scenario` | **角色定位** | `identity.md` |

**可改進點**：

- ✅ 已有：世界觀、範例對話
- ⚠️ 可加強：外貌描述（用於 portrait 生成）、MBTI/性格關鍵詞

### World Info（Lorebooks）

**World Info 核心概念**：

- **動態注入**：只在提及關鍵字時才注入相關背景資訊
- **多 key 指向同一 value**：`["Tokyo", "東京", "首都"]` → 同一條背景資訊
- **Outlet 系統**：用 `{{outlet::名稱}}` 手動控制注入位置

**結構範例**：

```json
{
  "entries": [
    {
      "keys": ["ClaudeCab", "專案", "框架"],
      "content": "ClaudeCab 是輕量級多代理框架，讓 Claude Code 成為可被遠端操控的專業助手。",
      "enabled": true,
      "insertion_order": 100
    }
  ]
}
```

**參考資源**：

- [World Info | docs.ST.app](https://docs.sillytavern.app/usage/core-concepts/worldinfo/)
- [SillyTavernAI Lorebooks Guide with Gemini 2.5](https://www.arsturn.com/blog/sillytavernai-lorebooks-with-gemini-2-5-a-complete-guide)
- [World Info Encyclopedia](https://rentry.co/world-info-encyclopedia)

**應用於 ClaudeCab**：

ClaudeCab 的 `knowledge/` 已經提供類似功能，但可增強：

1. **關鍵字觸發機制**：
   - 使用者提到「Telegram bot」→ 自動引用 `knowledge/tools/telegram-api.md`
   - 提到「記憶系統」→ 引用 `knowledge/cases/memory-best-practices.md`

2. **跨 Agent 知識共享**：
   - `_shared/knowledge/` 可視化為「公司知識庫」
   - Agent 自動搜尋相關 knowledge entries

3. **知識版本控制**：
   - 標記知識的新鮮度（Last Updated）
   - 過時知識自動提示更新

### Memory Books 擴展

**SillyTavern-MemoryBooks** 特色（來自 GitHub）：

- 自動儲存對話中的重要記憶到 Lorebooks
- 標記場景（scene markers）
- 生成 JSON 格式的結構化摘要
- 向量化儲存（用於語意搜尋）

**參考資源**：

- [GitHub - aikohanasaki/SillyTavern-MemoryBooks](https://github.com/aikohanasaki/SillyTavern-MemoryBooks)

**應用於 ClaudeCab**：

ClaudeCab 的 `memory/YYYY-MM-DD.md` 可升級為：

```markdown
# 2026-02-14

## 場景標記

### 🎯 專案討論（10:30-11:15）
- 參與者：Cab, general, coder
- 主題：Live 頁面 Party Roster 功能設計
- 決策：使用圓形頭像、顯示心情 emoji

### 💬 技術交流（14:20-15:00）
- 參與者：Cab, coder
- 主題：Serena MCP 工具使用
- 學習：symbol-level 編輯優於檔案級編輯

## 關鍵記憶

- **Cab 偏好**：簡短回應、極少 emoji、結果先行
- **新功能**：Party Roster 需要即時更新（SSE 同步）
- **技術決策**：Portrait 使用 4:3 比例而非 16:9

## 情緒記錄

- Cab 對冗長回應感到挫折（「閱讀起來真的好痛苦喔」）
- 對 Roster 功能實現感到滿意
```

---

## Character.AI 對話引擎設計

### 角色一致性維持

**技術進步**（來自 Character.AI 2026 評論）：

1. **舊問題（2023）**：
   - 20-30 條訊息後角色開始混亂
   - Runaway text（寫一堆無意義段落）

2. **新改進（2026）**：
   - **PipSqueak 模型**：更長的角色一致性
   - **更緊湊的輸出**：清晰的句子而非段落堆疊
   - **Group Chat 智能化**：角色之間會真正互動（英雄 vs 反派會吵架）

**參考資源**：

- [Character.AI in 2026: Features, Usage Guide, and What's Coming Next](https://autoppt.com/blog/character-ai-evolution-complete-guide/)
- [Character.ai: A Deep Dive into User Engagement and Technology](https://opinly.ai/blog/cai)

**應用於 ClaudeCab**：

ClaudeCab 的 ReactionGenerator 已經有類似機制：

- ✅ 使用 `getAgentPersonality()` 取得角色定義
- ✅ 傳入 `recentMessages` 提供對話脈絡
- ⚠️ 可改進：檢測角色偏移（drift detection）

**Drift Detection 機制**：

```javascript
// 在 soul.md 中定義「核心特質檢查點」
const CORE_TRAITS_CHECKLIST = [
  "使用繁體中文",
  "簡短回應（10-25字）",
  "不使用「您」而用「你」",
  "不說「我理解」、「我明白」"
];

// 每 10 條對話檢查一次
function checkDrift(recentMessages, agentId) {
  const soul = getSoulMd(agentId);
  const violations = [];
  
  for (const msg of recentMessages.slice(-10)) {
    if (msg.includes('您')) violations.push('使用了敬語「您」');
    if (msg.length > 100) violations.push('回應過長');
  }
  
  if (violations.length > 0) {
    logDrift(agentId, violations);
    // 可選：自動調整 prompt 或提醒使用者
  }
}
```

### 多角色互動設計

**Group Chat 引擎改進**（來自 Character.AI）：

- **舊問題**：角色忽略彼此
- **新機制**：
  - 角色會根據關係互動（英雄 vs 反派會爭執）
  - 對話有連貫性（不是各說各話）

**應用於 ClaudeCab**：

目前 ClaudeCab 的 agent 之間沒有直接對話，可新增：

1. **Agent Chat Events**：
   ```typescript
   {
     type: 'agent_chat',
     fromAgentId: 'general',
     toAgentId: 'coder',
     message: '你那個 bug 修好了嗎？',
     mood: 'annoyed'
   }
   ```

2. **Affinity System**（好感度）：
   ```javascript
   const agentAffinity = {
     'general-coder': 75,  // 高好感（常合作）
     'general-leader': 50, // 中等（偶爾互動）
     'coder-nitterbot': 30 // 低（很少互動）
   };
   
   // 高好感 → 更友善的對話
   // 低好感 → 更公事公辦
   ```

3. **Social Interaction Scheduler**：
   - 每小時隨機挑 2 個 agent 對話
   - 對話內容根據 affinity 和最近事件生成

### 語音與即時互動

**2026 新功能**（來自 Character.AI 報導）：

- **Real-time Voice**：打電話給角色，即時語音對話
- **Personality Evolution**：根據互動歷史調整角色（友善對待 → 更親密）

**應用於 ClaudeCab**：

語音功能在 Live 頁面可行性低（專注於視覺），但 **Personality Evolution** 可實現：

```javascript
// 追蹤使用者與 agent 的互動歷史
const userInteractionHistory = {
  'general': {
    totalInteractions: 145,
    positiveInteractions: 120,  // 讚美、感謝
    negativeInteractions: 10,   // 批評、忽略
    affinity: 0.83  // (120-10)/145 = 0.76 → 調整為 0.83
  }
};

// 根據 affinity 調整 agent 回應風格
function adjustResponseByAffinity(message, affinity) {
  if (affinity > 0.8) {
    // 更親密、更隨意
    return message.replace('你好', '嘿').replace('謝謝', '感恩～');
  } else if (affinity < 0.3) {
    // 更冷淡、更公式化
    return message.replace('嘿', '你好').replace('感恩～', '謝謝');
  }
  return message;
}
```

---

## Galgame 核心機制

### 選擇分支系統

**經典 Galgame 選擇設計**：

1. **選項類型**：
   - **劇情分歧**：導向不同結局
   - **好感度選擇**：影響角色關係
   - **資訊收集**：解鎖新對話或場景

2. **選擇呈現**：
   - 2-4 個選項（太多會決策疲勞）
   - 有時間限制（營造緊張感）
   - 隱藏選項（滿足條件才出現）

**參考資源**：

- [Meaningful Decisions in Branching Narratives](https://www.gamedeveloper.com/design/meaningful-decisions-in-branching-narratives)
- [Standard Patterns in Choice-Based Games](https://heterogenoustasks.wordpress.com/2015/01/26/standard-patterns-in-choice-based-games/)

**應用於 ClaudeCab**：

在 Portrait 對話面板加入選擇系統：

```javascript
// 範例：agent 完成任務後的回應選項
const responseOptions = [
  {
    label: '👍 幹得好！',
    effect: { affinity: +5, mood: 'excited' },
    response: '謝啦～這個 bug 確實有點棘手'
  },
  {
    label: '💪 辛苦了',
    effect: { affinity: +3, mood: 'neutral' },
    response: '還好啦，就是花了點時間'
  },
  {
    label: '🤔 下次可以更快',
    effect: { affinity: -2, mood: 'annoyed' },
    response: '...我盡力了啊，這次真的很複雜'
  }
];

// 顯示選項 UI
function showResponseOptions(options) {
  const container = document.querySelector('.dialogue-options');
  options.forEach(opt => {
    const btn = document.createElement('button');
    btn.textContent = opt.label;
    btn.onclick = () => selectResponse(opt);
    container.appendChild(btn);
  });
}
```

### 好感度系統

**Galgame 好感度機制**：

- **數值範圍**：0-100（或 -100 到 +100）
- **影響因素**：
  - 對話選擇 ±5
  - 完成任務 +10
  - 送禮物 +15
  - 忽略訊息 -5
- **可視化**：
  - 心形圖示（空心 → 半滿 → 全滿）
  - 顏色漸變（紅→粉→白）
  - 文字標籤（陌生 → 熟悉 → 親密 → 摯友）

**參考資源**：

- [Branching Narrative | Larksuite Gaming Glossary](https://www.larksuite.com/en_us/topics/gaming-glossary/branching-narrative)

**應用於 ClaudeCab**：

```javascript
// Affinity 等級定義
const AFFINITY_LEVELS = [
  { min: 0, max: 20, label: '陌生', icon: '🤝', color: '#94a3b8' },
  { min: 21, max: 40, label: '熟悉', icon: '😊', color: '#60a5fa' },
  { min: 41, max: 60, label: '信任', icon: '💙', color: '#3b82f6' },
  { min: 61, max: 80, label: '親密', icon: '💖', color: '#ec4899' },
  { min: 81, max: 100, label: '摯友', icon: '✨', color: '#f59e0b' }
];

// 在 Roster 卡片顯示好感度
function getAffinityLevel(affinity) {
  return AFFINITY_LEVELS.find(lvl => affinity >= lvl.min && affinity <= lvl.max);
}

// Roster 卡片加入好感度指示
const level = getAffinityLevel(agentData.affinity);
card.innerHTML += `
  <div class="affinity-badge" style="color: ${level.color}">
    ${level.icon} ${level.label}
  </div>
`;
```

### CG 收集系統

**Galgame CG 機制**：

- **解鎖條件**：特定劇情點、達成好感度、完成任務
- **Gallery 展示**：CG 圖庫，可回顧已解鎖的圖片
- **完成度追蹤**：顯示已收集 X / 總數 Y

**應用於 ClaudeCab**：

```javascript
// CG 定義
const CG_COLLECTION = [
  {
    id: 'coder-first-success',
    title: '第一次成功部署',
    unlockCondition: { event: 'workflow:completed', agentId: 'coder', count: 1 },
    imageUrl: '/cg/coder-success.png',
    unlocked: false
  },
  {
    id: 'general-stressed',
    title: '壓力爆表的一天',
    unlockCondition: { mood: 'tired', duration: 3600000 }, // 1 hour
    imageUrl: '/cg/general-stressed.png',
    unlocked: false
  }
];

// 檢查解鎖
function checkCGUnlock(event) {
  CG_COLLECTION.forEach(cg => {
    if (!cg.unlocked && meetsCondition(event, cg.unlockCondition)) {
      cg.unlocked = true;
      showCGUnlockNotification(cg);
    }
  });
}

// 解鎖通知（浮動卡片）
function showCGUnlockNotification(cg) {
  const notification = document.createElement('div');
  notification.className = 'cg-unlock-notification';
  notification.innerHTML = `
    <div class="cg-preview">
      <img src="${cg.imageUrl}" alt="${cg.title}">
    </div>
    <div class="cg-info">
      <h3>🎉 解鎖新 CG！</h3>
      <p>${cg.title}</p>
    </div>
  `;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 5000);
}
```

### 結局分歧

**Galgame 結局設計**：

- **多結局**：根據好感度、選擇、完成度決定
- **True Ending**：達成所有條件才能解鎖的真結局
- **Bad Ending**：錯誤選擇或忽略關鍵事件

**應用於 ClaudeCab**：

「結局」可改為「里程碑成就」：

```javascript
// 里程碑定義
const MILESTONES = [
  {
    id: 'all-agents-happy',
    title: '全員滿足',
    description: '所有 agent 同時處於 excited mood',
    condition: () => {
      return Object.values(agentCards).every(a => a.mood === 'excited');
    },
    reward: '解鎖特殊辦公室場景：慶功宴'
  },
  {
    id: 'burnout-survivor',
    title: '過勞倖存者',
    description: '某個 agent 持續 tired 狀態 24 小時後恢復',
    condition: (event) => {
      // 追蹤 tired 狀態持續時間
      return event.metadata?.tiredDuration > 24 * 3600000 && event.mood !== 'tired';
    },
    reward: '解鎖 CG：咖啡救贖'
  }
];
```

---

## 模擬經營機制

### 資源管理

**經典模擬經營資源**：

- **金錢**：完成任務賺取、花費在升級
- **時間**：任務需要時間完成
- **材料**：特定任務需要特定工具或技能

**應用於 ClaudeCab**：

ClaudeCab 可引入「專案資源」概念：

```javascript
const PROJECT_RESOURCES = {
  budget: 10000,      // 專案預算
  timeline: 30,       // 剩餘天數
  morale: 75,         // 團隊士氣（全體 agent mood 平均）
  quality: 0          // 專案品質（累積完成任務的品質分數）
};

// 任務完成影響資源
activityService.on('workflow:completed', (event) => {
  PROJECT_RESOURCES.quality += calculateQuality(event);
  PROJECT_RESOURCES.morale += 5; // 完成任務提升士氣
});

// 資源可視化
<div class="project-resources">
  <div class="resource">💰 預算：${PROJECT_RESOURCES.budget}</div>
  <div class="resource">📅 天數：${PROJECT_RESOURCES.timeline}</div>
  <div class="resource">😊 士氣：${PROJECT_RESOURCES.morale}</div>
  <div class="resource">⭐ 品質：${PROJECT_RESOURCES.quality}</div>
</div>
```

### 升級解鎖

**模擬經營升級系統**：

- **建築升級**：提升效率、解鎖新功能
- **員工訓練**：學習新技能
- **研究科技**：解鎖新工具

**參考資源**：

- [Game Dev Story | Kairosoft Wiki](https://kairosoft.fandom.com/wiki/Game_Dev_Story)

**應用於 ClaudeCab**：

```javascript
// Agent 技能樹
const SKILL_TREE = {
  coder: {
    'debugging-master': {
      name: 'Debug 大師',
      description: 'Error phase 恢復速度 +50%',
      cost: { xp: 100, budget: 500 },
      unlocked: false,
      effect: { errorRecoverySpeed: 1.5 }
    },
    'code-reviewer': {
      name: 'Code Review 專家',
      description: '完成任務時品質 +20%',
      cost: { xp: 150, budget: 800 },
      prerequisite: 'debugging-master',
      unlocked: false,
      effect: { qualityBonus: 1.2 }
    }
  }
};

// 解鎖技能
function unlockSkill(agentId, skillId) {
  const skill = SKILL_TREE[agentId][skillId];
  if (canUnlock(agentId, skill)) {
    skill.unlocked = true;
    applySkillEffect(agentId, skill.effect);
    showUnlockAnimation(agentId, skill);
  }
}
```

### 隨機事件

**模擬經營隨機事件**：

- **正面事件**：天降大單、員工升職
- **負面事件**：設備故障、員工請假
- **中性事件**：市場變化、競爭對手動向

**應用於 ClaudeCab**：

```javascript
// 隨機事件池
const RANDOM_EVENTS = [
  {
    id: 'coffee-machine-broken',
    title: '☕ 咖啡機壞了',
    description: '辦公室咖啡機故障，所有 agent mood -10',
    probability: 0.05,
    effect: { allAgentsMood: -10 },
    duration: 3600000 // 1 hour
  },
  {
    id: 'pizza-party',
    title: '🍕 披薩派對',
    description: '使用者訂了披薩，所有 agent mood +15',
    probability: 0.03,
    effect: { allAgentsMood: +15, affinity: +5 }
  },
  {
    id: 'deadline-approaching',
    title: '⏰ 死線將至',
    description: '專案 deadline 剩 3 天，壓力增加',
    probability: 0.1,
    effect: { allAgentsMood: -5, workSpeed: +20 }
  }
];

// 每小時檢查是否觸發隨機事件
setInterval(() => {
  const event = RANDOM_EVENTS.find(e => Math.random() < e.probability);
  if (event) {
    triggerRandomEvent(event);
  }
}, 3600000); // 1 hour
```

---

## 成就/收集系統

### Achievement 設計原則

**關鍵洞察**（來自遊戲化研究）：

1. **分層設計**：
   - **Easy**：新手友好（第一次完成任務）
   - **Medium**：需要持續努力（連續 7 天）
   - **Hard**：長期目標（累積 100 個任務）
   - **Secret**：隱藏成就（需要特殊條件）

2. **內在 vs 外在獎勵**：
   - **內在**：解鎖成就本身的滿足感
   - **外在**：獲得頭銜、徽章、CG

3. **進度可視化**：
   - 顯示「已完成 X / 總共 Y」
   - 進度條（75% 完成）

**參考資源**：

- [Streaks and Milestones for Gamification in Mobile Apps](https://www.plotline.so/blog/streaks-for-gamification-in-mobile-apps)
- [How Streaks Leverages Gamification to Boost Retention (2025)](https://trophy.so/blog/streaks-gamification-case-study)
- [Gamification in Learning: How to Use Streaks](https://www.growthengineering.co.uk/gamification-streaks/)

### Streak 機制

**Streak 心理學**（來自 Duolingo 案例研究）：

- **Loss Aversion**：人們更在意失去已建立的 streak（比獲得新 streak 更有動力）
- **7+ Day Threshold**：建立 7 天 streak 的使用者，日活躍度提高 2.3 倍
- **Retention Impact**：雙重遊戲化系統（streak + milestone）降低 30 天流失率 35%

**應用於 ClaudeCab**：

```javascript
// Streak 追蹤
const STREAKS = {
  daily_login: {
    name: '每日簽到',
    description: '連續登入 Live 頁面',
    currentStreak: 5,
    longestStreak: 12,
    lastCheckIn: '2026-02-14'
  },
  task_completion: {
    name: '任務達人',
    description: '連續完成每日任務',
    currentStreak: 3,
    longestStreak: 7
  }
};

// Streak 可視化
<div class="streak-display">
  <div class="streak-icon">🔥</div>
  <div class="streak-count">{currentStreak} 天</div>
  <div class="streak-label">連續簽到</div>
  <div class="streak-best">最佳：{longestStreak} 天</div>
</div>

// Streak 斷掉警告
if (daysSinceLastCheckIn === 1) {
  showStreakWarning('再不登入，你的 5 天 streak 就要斷了！');
}
```

### 成就範例設計

```javascript
const ACHIEVEMENTS = [
  // === 新手成就 ===
  {
    id: 'first-task',
    title: '🎯 初試啼聲',
    description: '完成第一個任務',
    tier: 'bronze',
    points: 10,
    condition: { totalTasksCompleted: 1 }
  },
  {
    id: 'meet-all-agents',
    title: '👋 認識大家',
    description: '開啟所有 agent 的 portrait 面板',
    tier: 'bronze',
    points: 15,
    condition: { portraitsOpened: 5 }
  },
  
  // === 進階成就 ===
  {
    id: 'streak-7',
    title: '🔥 熱血七日',
    description: '連續 7 天登入',
    tier: 'silver',
    points: 50,
    condition: { dailyLoginStreak: 7 }
  },
  {
    id: 'task-master',
    title: '⚡ 任務大師',
    description: '累積完成 100 個任務',
    tier: 'silver',
    points: 100,
    condition: { totalTasksCompleted: 100 }
  },
  
  // === 困難成就 ===
  {
    id: 'affinity-max',
    title: '💖 摯友達成',
    description: '與任一 agent 的好感度達到 100',
    tier: 'gold',
    points: 200,
    condition: { maxAffinity: 100 }
  },
  {
    id: 'all-cg-unlocked',
    title: '🖼️ 收藏家',
    description: '解鎖所有 CG',
    tier: 'gold',
    points: 300,
    condition: { cgUnlocked: 'all' }
  },
  
  // === 隱藏成就 ===
  {
    id: 'night-owl',
    title: '🦉 夜貓子',
    description: '凌晨 3:00-5:00 之間完成任務',
    tier: 'secret',
    points: 50,
    condition: { taskCompletedAtNight: true },
    hidden: true
  },
  {
    id: 'burnout-recovery',
    title: '🌈 浴火重生',
    description: 'Agent 從 tired 狀態持續 24 小時後恢復',
    tier: 'secret',
    points: 150,
    condition: { burnoutRecovery: true },
    hidden: true
  }
];
```

---

## 進度可視化

### XP/Level 系統

**經典設計**（來自 RPG/模擬經營遊戲）：

- **經驗值來源**：完成任務、達成成就、日常簽到
- **等級曲線**：遞增式（Level 1→2 需 100 XP，Level 2→3 需 150 XP）
- **等級獎勵**：解鎖新功能、提升效率、獲得徽章

**參考資源**：

- [Game UI Database - Skill Tree](https://www.gameuidatabase.com/index.php?scrn=64)
- [Fill the progress. How to design the perfect game progress bar?](https://medium.com/@MaxKosyakoff/fill-the-progress-fc0fa99cabac)

**應用於 ClaudeCab**：

```javascript
// Agent 等級系統
const agentLevel = {
  coder: {
    level: 5,
    xp: 350,
    xpToNextLevel: 500,
    totalXP: 1350
  }
};

// XP 進度條
<div class="xp-bar-container">
  <div class="xp-bar" style="width: ${(xp / xpToNextLevel) * 100}%"></div>
  <div class="xp-text">Lv.{level} — {xp} / {xpToNextLevel} XP</div>
</div>

// 升級動畫
function levelUp(agentId) {
  const agent = agentCards[agentId];
  agent.level++;
  
  // 顯示升級特效
  showLevelUpEffect(agentId);
  playSound('levelup');
  
  // 解鎖獎勵
  const reward = LEVEL_REWARDS[agent.level];
  if (reward) {
    showRewardNotification(reward);
  }
}
```

### 儀表板統計

**設計原則**（來自 UI 最佳實踐）：

- **關鍵指標優先**：最重要的數字最大、最顯眼
- **趨勢指示**：↑ 上升 / ↓ 下降 / → 持平
- **顏色編碼**：綠=好、黃=警告、紅=危險

**應用於 ClaudeCab**：

在 Header 或 Sidebar 加入統計儀表板：

```html
<div class="stats-dashboard">
  <div class="stat-card">
    <div class="stat-icon">✅</div>
    <div class="stat-value">127</div>
    <div class="stat-label">本週完成</div>
    <div class="stat-trend up">+12%</div>
  </div>
  
  <div class="stat-card">
    <div class="stat-icon">⚡</div>
    <div class="stat-value">87%</div>
    <div class="stat-label">團隊士氣</div>
    <div class="stat-trend down">-3%</div>
  </div>
  
  <div class="stat-card">
    <div class="stat-icon">🔥</div>
    <div class="stat-value">15</div>
    <div class="stat-label">連續天數</div>
    <div class="stat-trend stable">→</div>
  </div>
</div>
```

---

## 總結：功能/機制應用優先級

### Quick Wins（短期實現）

1. ✅ **好感度系統基礎**：
   - Agent affinity 數值追蹤
   - Roster 卡片顯示親密度等級

2. ✅ **基礎成就系統**：
   - 定義 10-15 個成就
   - 成就解鎖通知（浮動卡片）

3. ✅ **Streak 追蹤**：
   - 每日登入 streak
   - Streak 斷掉警告

### 中期開發

1. ⚙️ **對話選項系統**：
   - Portrait 面板加入回應選項
   - 選項影響 affinity 和 mood

2. ⚙️ **CG 收集**：
   - 定義 5-10 個解鎖條件
   - CG Gallery 展示介面

3. ⚙️ **Agent 等級/XP**：
   - XP 進度條
   - 升級動畫與獎勵

4. ⚙️ **隨機事件**：
   - 定時觸發辦公室事件
   - 事件影響 mood 和資源

### 長期願景

1. 🎯 **完整技能樹**：
   - 每個 agent 獨立技能路徑
   - 技能解鎖與升級 UI

2. 🎯 **多結局/里程碑系統**：
   - 根據好感度、完成度解鎖特殊結局
   - True Ending 條件

3. 🎯 **Agent 之間互動**：
   - Agent Chat Events
   - Social Interaction Scheduler
   - Affinity 影響對話內容

4. 🎯 **完整資源管理**：
   - 專案預算、時間、品質追蹤
   - 資源影響任務選擇
