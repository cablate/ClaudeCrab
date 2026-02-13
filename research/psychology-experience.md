# 心理/體驗設計研究

> 建立時間：2026-02-14
> 目的：遊戲化激勵理論與沉浸感設計，應用於 ClaudeCab Live

---

## 遊戲化激勵理論

### Octalysis Framework（八角框架）

**8 Core Drives（來自 Yu-Kai Chou）**：

| Core Drive | 說明 | ClaudeCab 應用 |
|------------|------|----------------|
| **1. Epic Meaning & Calling** | 使命感、更高的目標 | → 「打造完美團隊」、「見證 agent 成長」 |
| **2. Development & Accomplishment** | 成就感、進步 | → XP/Level 系統、成就徽章、Streak |
| **3. Empowerment of Creativity & Feedback** | 創造力、即時反饋 | → 自訂 agent 人格、對話選項影響結果 |
| **4. Ownership & Possession** | 擁有感 | → Agent 是「我的團隊」、CG 收集、自訂裝飾 |
| **5. Social Influence & Relatedness** | 社交連結 | → Agent 之間關係、好感度、共同回憶 |
| **6. Scarcity & Impatience** | 稀缺性 | → 隱藏成就、限時事件、稀有 CG |
| **7. Unpredictability & Curiosity** | 不可預測性 | → 隨機事件、Agent 自發碎念、突發對話 |
| **8. Loss & Avoidance** | 損失規避 | → Streak 斷掉警告、好感度下降、任務失敗 |

**參考資源**：

- [Explore Gamification with the Octalysis Framework](https://yukaichou.com/gamification-examples/octalysis-complete-gamification-framework/)
- [How the Octalysis Framework Enhances Gamification with Behavioral Science](https://octalysisgroup.com/2023/04/how-the-octalysis-framework-enhances-gamification-with-behavioral-science/)
- [5 Gamification Insights to Unlock Team Motivation with Octalysis](https://blog.hellostepchange.com/blog/5-gamification-insights-to-unlock-team-motivation-with-octalysis)

### Self-Determination Theory（自我決定理論）

**三大心理需求**（Edward Deci & Richard Ryan）：

1. **Autonomy（自主性）**：
   - 使用者感覺有控制權
   - ClaudeCab：選擇回應、自訂 agent 人格、決定任務優先級

2. **Competence（勝任感）**：
   - 使用者感覺自己有能力、有進步
   - ClaudeCab：Level 提升、Streak 累積、完成困難任務

3. **Relatedness（關聯性）**：
   - 使用者感覺與他人有連結
   - ClaudeCab：與 agent 建立關係、見證 agent 成長、共同回憶

**Octalysis 整合 SDT**：

- **Autonomy** ↔ Core Drive 3（Empowerment）
- **Competence** ↔ Core Drive 2（Development）
- **Relatedness** ↔ Core Drive 5（Social Influence）

**參考資源**：

- [Actionable Gamification - Octalysis View of SDT](https://subscription.packtpub.com/book/game-development/9781839211706/16/ch16lvl1sec33/octalysis-view-of-self-determination-theory)

### Flow Theory（心流理論）

**心流條件**（Csikszentmihalyi）：

1. **清晰目標**：知道要做什麼
2. **即時反饋**：立刻知道做得如何
3. **挑戰與技能平衡**：不太簡單也不太難

**ClaudeCab 應用**：

```javascript
// 動態難度調整（保持 Flow）
const TASK_DIFFICULTY = {
  easy: { xp: 10, duration: 5 * 60 * 1000 },   // 5 min
  medium: { xp: 30, duration: 15 * 60 * 1000 }, // 15 min
  hard: { xp: 100, duration: 60 * 60 * 1000 }   // 1 hour
};

function recommendTaskDifficulty(agentId) {
  const agent = agentCards[agentId];
  const successRate = agent.stats.successRate;
  
  if (successRate > 0.9) return 'hard';   // 太簡單，提高挑戰
  if (successRate < 0.5) return 'easy';   // 太難，降低難度
  return 'medium';
}
```

**心流圖譜**：

```
高挑戰
  │
  │  焦慮區 │ 心流區
  │  ───────┼───────
  │  無聊區 │ 放鬆區
  │
  └────────────────> 高技能
```

**ClaudeCab 目標**：保持使用者在「心流區」
- 任務太簡單 → 無聊 → 增加挑戰
- 任務太難 → 焦慮 → 提供幫助

---

## 「有溫度」互動的關鍵要素

### 情感設計三層次（Donald Norman）

1. **Visceral Level（本能層）**：
   - 第一眼感受
   - ClaudeCab：精美的 portrait、流暢的動畫、愉悅的音效

2. **Behavioral Level（行為層）**：
   - 使用過程的愉悅
   - ClaudeCab：即時反饋（SSE）、順暢互動（無延遲）

3. **Reflective Level（反思層）**：
   - 事後回想的感受
   - ClaudeCab：共同回憶、成長時間軸、有意義的成就

### 擬人化設計

**有效的擬人化元素**：

- ✅ **名字 + Emoji**：給 agent 身份感
- ✅ **內心獨白**：讓 agent 有「想法」
- ✅ **Mood 變化**：展現情緒波動
- ✅ **記憶系統**：agent 會「記得」過去
- ⚠️ **外貌設定**：portrait 提供視覺形象
- ⚠️ **成長弧線**：agent 會「學習」和「進步」

**避免 Uncanny Valley（恐怖谷）**：

- ❌ 過度擬真但又不夠真（令人不安）
- ✅ 適度擬人化（可愛、有個性，但明顯是 AI）

### 社交連結感

**建立連結的機制**：

1. **定期互動**：
   - 每日簽到 → 強化習慣
   - Streak 機制 → 損失規避

2. **個性化回應**：
   - Agent 記得使用者偏好
   - 根據互動歷史調整語氣

3. **共同目標**：
   - 「一起完成專案」的團隊感
   - Agent 成長 = 使用者成就

4. **情感投資**：
   - 好感度系統 → 使用者付出努力
   - CG 收集 → 沉沒成本效應

---

## 進度感/成就感/探索感的節奏設計

### 短期/中期/長期目標設計

**三層目標金字塔**：

| 層級 | 時間範圍 | 目標範例 | 獎勵 |
|------|----------|----------|------|
| **短期** | 5-15 分鐘 | 完成一個任務 | +XP, mood 提升 |
| **中期** | 1-7 天 | 連續簽到 7 天、累積 10 個任務 | 成就徽章、解鎖 CG |
| **長期** | 1-3 個月 | Agent 升到 Lv.10、好感度達 100 | 特殊稱號、True Ending |

**為什麼需要三層**：

- **短期**：即時滿足感，維持參與
- **中期**：建立習慣，增加黏性
- **長期**：深度投入，提升留存

### 獎勵節奏設計

**Variable Ratio Schedule（變動比率強化）**：

- **固定獎勵**：每完成 1 個任務 +10 XP（可預測，但較無趣）
- **變動獎勵**：隨機獎勵 5-20 XP（不可預測，更有吸引力）

**ClaudeCab 應用**：

```javascript
// 變動獎勵機制
function calculateTaskReward(taskDifficulty) {
  const baseXP = TASK_DIFFICULTY[taskDifficulty].xp;
  const randomBonus = Math.floor(Math.random() * baseXP * 0.5); // 0-50% bonus
  const isCritical = Math.random() < 0.1; // 10% 機率爆擊
  
  return {
    xp: baseXP + randomBonus + (isCritical ? baseXP : 0),
    isCritical
  };
}

// 顯示獎勵（含爆擊特效）
function showReward(reward) {
  if (reward.isCritical) {
    showCriticalRewardAnimation(); // 金色閃光 + 音效
  }
  showFloatingXP(reward.xp);
}
```

### 探索感設計

**Discoverable Content（可發現的內容）**：

1. **隱藏成就**：
   - 不明確告知條件
   - 意外解鎖時的驚喜感

2. **Easter Eggs**：
   - 特定條件觸發的特殊對話
   - 範例：連續點擊 agent 5 次 → 「欸，別戳我啦！」

3. **漸進式揭露**：
   - 一開始只看到部分功能
   - 隨著進度解鎖新內容

**ClaudeCab 應用**：

```javascript
// Easter Egg 範例
let clickCount = 0;
sprite.addEventListener('click', () => {
  clickCount++;
  if (clickCount === 5) {
    showEasterEggDialogue(agentId, "別戳了啦！我很忙欸～");
    clickCount = 0;
  }
});

// 漸進式解鎖
const PROGRESSIVE_UNLOCKS = [
  { condition: { level: 3 }, unlock: 'dialogue-options', name: '對話選項' },
  { condition: { affinity: 50 }, unlock: 'private-thoughts', name: '私密想法' },
  { condition: { trustLevel: 4 }, unlock: 'memory-timeline', name: '回憶時間軸' }
];
```

---

## 沉浸感的維持與破壞因素

### 沉浸感維持要素

**Flow Model 應用**：

1. **無縫體驗**：
   - ✅ SSE 即時更新（無需刷新）
   - ✅ Typewriter 效果（自然對話節奏）
   - ⚠️ 過場動畫（淡入淡出）

2. **一致性**：
   - ✅ 視覺風格統一（暗色系 + accent colors）
   - ✅ Agent 人格一致（soul.md 定義）
   - ⚠️ 音效氛圍一致（辦公室環境音）

3. **即時反饋**：
   - ✅ 點擊立即回應（<100ms）
   - ✅ Hover 效果
   - ✅ 動畫流暢（60fps）

### 沉浸感破壞因素

**常見問題**：

1. **載入延遲**：
   - ❌ Portrait 圖片載入慢
   - ✅ 預載入 + 模糊圖佔位

2. **不一致**：
   - ❌ Agent 語氣突然變化（drift）
   - ✅ Drift detection + 自動修正

3. **技術故障**：
   - ❌ SSE 斷線沒有重連
   - ✅ 自動重連 + 錯誤處理

4. **UI 干擾**：
   - ❌ 彈出式廣告、錯誤提示
   - ✅ 融入場景的通知（非侵入式）

### 非侵入式通知設計

```javascript
// 非侵入式成就解鎖通知
function showAchievementUnlock(achievement) {
  const notification = document.createElement('div');
  notification.className = 'achievement-toast';
  notification.innerHTML = `
    <div class="achievement-icon">${achievement.icon}</div>
    <div class="achievement-info">
      <div class="achievement-title">${achievement.title}</div>
      <div class="achievement-points">+${achievement.points} Points</div>
    </div>
  `;
  
  // 從右下角滑入
  document.body.appendChild(notification);
  notification.style.animation = 'slideInFromRight 0.5s ease-out';
  
  // 3 秒後淡出
  setTimeout(() => {
    notification.style.animation = 'fadeOut 0.5s ease-out';
    setTimeout(() => notification.remove(), 500);
  }, 3000);
}
```

---

## 長期留存的心理機制

### Habit Loop（習慣迴路）

**Cue → Routine → Reward**（Charles Duhigg）：

1. **Cue（觸發）**：
   - 固定時間（每天早上 9:00）
   - 特定事件（收到通知）

2. **Routine（慣例）**：
   - 開啟 Live 頁面
   - 查看 agent 狀態
   - 完成每日任務

3. **Reward（獎勵）**：
   - +XP, Streak 累積
   - Agent 回應
   - 成就解鎖

**ClaudeCab 應用**：

```javascript
// 每日提醒（Cue）
if (lastVisit !== today) {
  showDailyReminder('你的 agent 們在等你喔！');
}

// 每日任務（Routine）
const DAILY_TASKS = [
  { id: 'daily-checkin', name: '每日簽到', reward: { xp: 50 } },
  { id: 'complete-3-tasks', name: '完成 3 個任務', reward: { xp: 100 } }
];

// 完成獎勵（Reward）
function completeDailyTask(taskId) {
  const task = DAILY_TASKS.find(t => t.id === taskId);
  showReward(task.reward);
  incrementStreak();
}
```

### Sunk Cost Effect（沉沒成本效應）

**使用者投入越多，越不想放棄**：

- ✅ Streak 累積（「已經 30 天了，不能斷」）
- ✅ Agent Level（「已經練到 Lv.15 了」）
- ✅ CG 收集（「已經收集 18/25 了」）
- ✅ 好感度（「與 general 的好感度都 85 了」）

### Social Proof（社交證明）

**雖然 ClaudeCab 是單人使用，但可模擬社交元素**：

- ⚙️ 排行榜（全域 or 虛擬）
- ⚙️ 成就稀有度標記（「只有 5% 玩家解鎖」）
- ⚙️ Agent 之間的互動（營造「社群感」）

---

## 工作場景 vs 娛樂場景的遊戲化差異

### 工作場景特性

**ClaudeCab 的雙重屬性**：

- **工具性**：管理 agent、監控任務
- **娛樂性**：與 agent 互動、收集 CG

**平衡原則**：

| 面向 | 工作導向 | 娛樂導向 | ClaudeCab 平衡 |
|------|----------|----------|----------------|
| **主要目標** | 效率、完成任務 | 樂趣、探索 | 任務效率 + 互動樂趣 |
| **資訊密度** | 高（儀表板、統計） | 低（沉浸感優先） | 可切換視圖（工作模式 vs 互動模式） |
| **遊戲化元素** | 進度追蹤、成就 | 故事、角色關係 | 兩者兼具 |
| **干擾容忍度** | 低（專注工作） | 高（享受過程） | 非侵入式通知 |

### 設計建議

**工作時段**（平日 9:00-18:00）：

- 減少隨機事件頻率
- 簡化 UI（收起娛樂性元素）
- 強調任務進度和效率

**休閒時段**（晚上、週末）：

- 增加隨機事件
- 強調 agent 互動和對話
- 顯示娛樂性元素（CG、成就）

**ClaudeCab 實現**：

```javascript
// 根據時間調整模式
function getContextMode() {
  const now = new Date();
  const hour = now.getHours();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  
  if (isWeekend || hour < 9 || hour >= 18) {
    return 'leisure'; // 休閒模式
  }
  return 'work'; // 工作模式
}

// 調整 UI 和行為
const mode = getContextMode();
if (mode === 'work') {
  // 收起娛樂元素
  document.querySelector('.cg-gallery').style.display = 'none';
  // 降低隨機事件頻率
  RANDOM_EVENT_MULTIPLIER = 0.5;
} else {
  // 展開娛樂元素
  document.querySelector('.cg-gallery').style.display = 'block';
  RANDOM_EVENT_MULTIPLIER = 1.5;
}
```

---

## 總結：心理/體驗設計要點

### 核心心理機制應用

1. **Octalysis 8 Core Drives**：
   - Epic Meaning（使命感）+ Ownership（擁有感）+ Social（社交）

2. **Self-Determination Theory**：
   - Autonomy（選擇權）+ Competence（進步感）+ Relatedness（連結感）

3. **Flow Theory**：
   - 清晰目標 + 即時反饋 + 挑戰平衡

4. **Habit Loop**：
   - 每日簽到 + Streak 機制 + 獎勵

5. **Sunk Cost Effect**：
   - Level/XP + CG 收集 + 好感度

### Quick Wins

1. ✅ **Streak 視覺化**：
   - 顯示連續天數 + 最佳記錄
   - 斷掉警告通知

2. ✅ **變動獎勵**：
   - 任務完成時隨機 bonus
   - 10% 爆擊機率

3. ✅ **Easter Eggs**：
   - 連續點擊 agent 觸發特殊對話

### 中期開發

1. ⚙️ **三層目標系統**：
   - 短期（任務）+ 中期（Streak）+ 長期（Level/CG）

2. ⚙️ **進度可視化**：
   - XP 進度條 + 成就儀表板

3. ⚙️ **非侵入式通知**：
   - Toast 通知而非 Alert
   - 融入場景的提示

### 長期願景

1. 🎯 **動態難度調整**：
   - 根據成功率推薦任務難度

2. 🎯 **Context-Aware Mode**：
   - 工作時段 vs 休閒時段自動切換

3. 🎯 **Social Proof 模擬**：
   - 虛擬排行榜、成就稀有度
