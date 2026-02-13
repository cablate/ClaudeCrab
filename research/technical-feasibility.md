# 技術實現可行性

> 建立時間：2026-02-14
> 目的：分析 Claude Agent SDK 框架下的能力邊界，評估各項優化方案的技術可行性

---

## Claude Agent SDK 框架約束

### 核心限制

**ClaudeCab 高度綁定 Claude Agent SDK**：

1. **Agent 執行環境**：
   - 每個 agent 是獨立的 Claude Code 執行環境
   - 透過 `claude` CLI 呼叫 Claude API
   - 不能直接執行 Python/Ruby 等（除非透過 Bash）

2. **通訊機制**：
   - 主要透過 Telegram Bot API
   - 使用 SQLite 作為共享資料庫
   - EventBus 用於內部事件廣播

3. **前端限制**：
   - 純 HTML/CSS/JS（無框架）
   - SSE 單向推送（server → client）
   - 不支援 WebSocket（雙向通訊）

### 能力邊界

**可行的擴展**：

- ✅ 純前端實現（CSS 動畫、Canvas、Web Audio）
- ✅ Server-side 邏輯（Node.js/TypeScript）
- ✅ Database schema 擴展（SQLite）
- ✅ SSE 事件格式擴展（metadata 欄位）
- ✅ Agent Skill 系統（Markdown 定義）

**不可行的擴展**：

- ❌ 切換到其他 LLM（綁定 Claude API）
- ❌ 使用 React/Vue 等框架（破壞簡潔性）
- ❌ WebSocket 即時通訊（架構未支援）
- ❌ 大量計算任務（Agent 執行環境限制）

---

## 現有 Codebase 架構分析

### 模組擴展潛力評估

**高擴展潛力模組**：

| 模組 | 當前功能 | 擴展潛力 | 擴展方向 |
|------|----------|----------|----------|
| **ActivityService** | Mood/Phase 追蹤、事件發射 | ⭐⭐⭐⭐⭐ | + Affinity, Energy, Status Effects |
| **ReactionGenerator** | Haiku 產生內心獨白 | ⭐⭐⭐⭐ | + 動作描述、表情標記、記憶引用 |
| **IdleMutterScheduler** | 定時碎念 | ⭐⭐⭐⭐ | + DailyRoutineScheduler, RandomEventScheduler |
| **SSEBroadcaster** | 廣播 activity events | ⭐⭐⭐⭐⭐ | + Agent-to-Agent events, System events |
| **ActivityRepository** | Events CRUD | ⭐⭐⭐⭐ | + Affinity/Chemistry tables, Achievement tracking |

**中等擴展潛力模組**：

| 模組 | 當前功能 | 擴展潛力 | 限制 |
|------|----------|----------|------|
| **MessageProcessor** | 處理使用者訊息 | ⭐⭐⭐ | 高度綁定 SDK QueryManager |
| **GroupBroadcaster** | 群組訊息廣播 | ⭐⭐⭐ | 目前只用於 Telegram groups |
| **WebUIServer** | Express 伺服器 | ⭐⭐⭐ | 已經很完整，擴展空間有限 |

**低擴展潛力模組**：

| 模組 | 當前功能 | 擴展潛力 | 原因 |
|------|----------|----------|------|
| **SDKQueryManager** | Claude SDK 整合 | ⭐⭐ | 核心邏輯，變動風險高 |
| **TelegramBot** | Telegram 整合 | ⭐⭐ | 第三方 API，擴展受限 |

### 擴展建議

**優先擴展（風險低、價值高）**：

1. **ActivityService 新增欄位**：
   ```typescript
   interface AgentExtendedState {
     // 現有
     mood: ActivityMood;
     phase: ActivityPhase;
     idleDuration: number;
     
     // 新增
     affinity: number;         // 好感度 0-100
     energy: number;           // 能量值 0-100
     statusEffects: string[];  // 狀態效果 ['focused', 'caffeinated']
     skillLevel: number;       // 技能等級
   }
   ```

2. **SSEBroadcaster 新事件類型**：
   ```typescript
   type ActivityEventType = 
     // 現有
     | 'reaction' | 'mutter' | 'reply' | 'status_change' | 'workflow'
     // 新增
     | 'agent_chat'       // Agent 之間對話
     | 'affinity_change'  // 好感度變化
     | 'achievement'      // 成就解鎖
     | 'random_event'     // 隨機事件
     | 'level_up';        // 升級
   ```

3. **Database Schema 擴展**：
   ```sql
   -- 新增表：好感度追蹤
   CREATE TABLE agent_affinity (
     user_id TEXT NOT NULL,
     agent_id TEXT NOT NULL,
     affinity INTEGER DEFAULT 0,
     chemistry_with TEXT, -- JSON: {"coder": 75, "leader": 60}
     trust_level INTEGER DEFAULT 1,
     interactions INTEGER DEFAULT 0,
     last_interaction TEXT,
     PRIMARY KEY (user_id, agent_id)
   );
   
   -- 新增表：成就追蹤
   CREATE TABLE achievements (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     achievement_id TEXT NOT NULL,
     unlocked_at TEXT NOT NULL,
     metadata TEXT -- JSON
   );
   
   -- 新增表：CG 收集
   CREATE TABLE cg_collection (
     id TEXT PRIMARY KEY,
     user_id TEXT NOT NULL,
     cg_id TEXT NOT NULL,
     unlocked_at TEXT NOT NULL,
     viewed_count INTEGER DEFAULT 0
   );
   ```

---

## SSE 事件流擴展能力

### 當前 SSE 架構

**流程**：

1. EventBus 發射 `activity` 事件
2. SSEBroadcaster 監聽並廣播給所有 clients
3. 前端 `connectSSE()` 接收並處理

**優勢**：

- ✅ 低延遲（<100ms）
- ✅ 自動重連機制
- ✅ 心跳保持

**限制**：

- ❌ 單向通訊（server → client）
- ❌ 無法主動查詢（需要透過 REST API）

### 擴展方案

**新增事件類型**（完全可行）：

```javascript
// Agent 之間對話
{
  type: 'agent_chat',
  fromAgentId: 'general',
  toAgentId: 'coder',
  message: '那個 bug 修好了嗎？',
  mood: 'neutral',
  metadata: { threadId: '123' }
}

// 好感度變化
{
  type: 'affinity_change',
  agentId: 'general',
  affinityDelta: +5,
  newAffinity: 75,
  reason: 'user-praise'
}

// 成就解鎖
{
  type: 'achievement',
  achievementId: 'first-task',
  title: '初試啼聲',
  points: 10
}

// 隨機事件
{
  type: 'random_event',
  eventId: 'coffee-machine-broken',
  title: '咖啡機壞了',
  effects: { allAgentsMood: -10 }
}
```

**前端處理**：

```javascript
// 擴展 SSE 事件處理
source.addEventListener('message', (e) => {
  const event = JSON.parse(e.data);
  
  switch (event.type) {
    case 'agent_chat':
      handleAgentChat(event);
      break;
    case 'affinity_change':
      updateAffinityDisplay(event);
      break;
    case 'achievement':
      showAchievementUnlock(event);
      break;
    case 'random_event':
      triggerRandomEventAnimation(event);
      break;
    // ... 其他事件
  }
});
```

---

## Agent 記憶/人格系統深度利用

### 現有記憶系統

**檔案結構**（每個 agent）：

```
agents/{id}/
├── .claude/skills/persona/references/
│   ├── soul.md         # 人格核心
│   └── identity.md     # 身份
├── memory/
│   ├── YYYY-MM-DD.md   # 每日記憶
│   └── ACTIVE.md       # 本 session 追蹤
└── knowledge/
    ├── tools/
    ├── cases/
    └── research/
```

### 深度利用方案

**1. Memory 結構化**：

目前 `memory/*.md` 是純文字，可改為結構化格式：

```markdown
# 2026-02-14

## Metadata
- session_count: 3
- total_interactions: 45
- avg_mood: tired
- key_topics: [live-page, research, portrait]

## Timeline

### 10:30 - 專案討論
- **參與者**: Cab, general, coder
- **主題**: Live 頁面研究計畫
- **決策**: 建立 research/ 目錄，全面蒐集設計參考
- **情緒**: Cab 疲憊但期待高

### 14:00 - 研究執行
- **任務**: 撰寫 7 份研究文件
- **進度**: 已完成 5/7
- **發現**: SillyTavern、Galgame、遊戲化理論大量可應用元素

## Key Learnings

- SillyTavern 的 Character Card 格式可應用於 soul.md 優化
- Octalysis 8 Core Drives 提供完整遊戲化框架
- CSS 動畫優先使用 GPU 加速屬性（transform, opacity）

## Affinity Changes

- Cab +5（信任我獨立研究）
```

**2. Knowledge Graph**：

將 `knowledge/` 建立為知識圖譜：

```javascript
// knowledge/graph.json
{
  "nodes": [
    { "id": "sillytavern", "type": "tool", "category": "ai-chat" },
    { "id": "character-card", "type": "concept", "parent": "sillytavern" },
    { "id": "world-info", "type": "concept", "parent": "sillytavern" }
  ],
  "edges": [
    { "from": "character-card", "to": "soul.md", "relation": "similar-to" },
    { "from": "world-info", "to": "knowledge-system", "relation": "inspired-by" }
  ]
}
```

**3. 動態 Prompt 注入**：

根據對話脈絡動態注入相關記憶：

```javascript
async function generateReactionWithMemory(agentId, phase, recentMessages) {
  // 1. 搜尋相關記憶
  const relevantMemories = await searchMemories(agentId, recentMessages);
  
  // 2. 組合 prompt
  const prompt = `
你是 ${agentName}。

**當前狀況**：${phaseDesc}

**相關記憶**：
${relevantMemories.map(m => `- ${m.date}: ${m.event}`).join('\n')}

**近期對話**：
${recentMessages.join('\n')}

根據記憶和脈絡，寫一句內心獨白（10-25字）。

回覆 JSON：{"message": "...", "mood": "..."}
  `;
  
  return await callHaiku(prompt);
}
```

---

## Scheduling + Mood + Phase 組合潛力

### 現有 Scheduling 機制

**IdleMutterScheduler**：

- 每 30 秒檢查閒置 agent
- 閒置 > 3 分鐘 + 有觀眾 → 15% 機率碎念
- 每小時上限 3 次

### 擴展方案

**1. DailyRoutineScheduler**：

```javascript
class DailyRoutineScheduler {
  private schedule = [
    { time: '09:00', event: 'morning-checkin', moodTarget: 'neutral' },
    { time: '12:00', event: 'lunch-break', moodTarget: 'excited' },
    { time: '15:00', event: 'afternoon-slump', moodTarget: 'tired' },
    { time: '18:00', event: 'end-of-day', moodTarget: 'neutral' }
  ];
  
  async checkSchedule() {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:00`;
    const event = this.schedule.find(e => e.time === currentTime);
    
    if (event) {
      await this.triggerRoutineEvent(event);
    }
  }
  
  private async triggerRoutineEvent(event: RoutineEvent) {
    // 所有 agent 的 mood 朝 target 轉換
    for (const agentId of this.trackedAgents) {
      this.activityService.emitStatusChange(agentId, 'idle', event.moodTarget);
      
      // 產生對應的碎念
      const message = await this.generateRoutineMessage(agentId, event.event);
      this.activityService.emitMutter(agentId, message, event.moodTarget);
    }
  }
}
```

**2. MoodRecoveryScheduler**：

```javascript
class MoodRecoveryScheduler {
  async checkMoodRecovery() {
    for (const [agentId, state] of this.agentStates) {
      // Tired 持續 > 1 小時 → 自動恢復
      if (state.mood === 'tired' && state.moodDuration > 3600000) {
        this.activityService.emitStatusChange(agentId, 'idle', 'neutral');
        this.activityService.emitMutter(agentId, '呼...休息一下，好多了。', 'neutral');
      }
      
      // Annoyed 持續 > 30 分鐘 → 漸漸平靜
      if (state.mood === 'annoyed' && state.moodDuration > 1800000) {
        this.activityService.emitStatusChange(agentId, 'idle', 'neutral');
      }
    }
  }
}
```

**3. SocialInteractionScheduler**：

```javascript
class SocialInteractionScheduler {
  async triggerRandomInteraction() {
    // 隨機挑 2 個 agent
    const [agent1, agent2] = this.pickRandomAgents(2);
    
    // 根據 chemistry 決定對話內容
    const chemistry = this.getChemistry(agent1.id, agent2.id);
    
    if (chemistry > 60) {
      // 高默契 → 閒聊
      await this.generateChatEvent(agent1, agent2, 'casual');
    } else if (chemistry < 40) {
      // 低默契 → 公事
      await this.generateChatEvent(agent1, agent2, 'professional');
    } else {
      // 中等 → 工作討論
      await this.generateChatEvent(agent1, agent2, 'collaboration');
    }
  }
}
```

---

## 前端技術可行性

### CSS 動畫 — ⭐⭐⭐⭐⭐（高可行）

**已驗證技術**：

- ✅ `@keyframes` 動畫（無限循環、緩動函數）
- ✅ `transform` GPU 加速
- ✅ `transition` 平滑過渡
- ✅ `will-change` 性能提示

**可實現效果**：

- Roster 卡片進場動畫（slideInUp + 延遲）
- Portrait 呼吸動畫（translateY -2px）
- 氣泡彈出動畫（scale + translateY）
- Hover 3D 傾斜（rotateX + rotateY）
- 粒子爆發（translate + opacity fadeout）

### Canvas — ⭐⭐⭐⭐（中高可行）

**用途**：

- ✅ 粒子效果（五彩紙片、漂浮灰塵）
- ✅ Agent 關係連線（線條、節點）
- ✅ 自訂進度條/圖表
- ⚠️ 複雜動畫（需要優化）

**實現範例**：

```javascript
// Particle System
class ParticleSystem {
  constructor(canvas) {
    this.ctx = canvas.getContext('2d');
    this.particles = [];
  }
  
  emit(x, y, count = 20) {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5,
        life: 1.0,
        color: this.randomColor()
      });
    }
  }
  
  update() {
    this.particles = this.particles.filter(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.02;
      return p.life > 0;
    });
  }
  
  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles.forEach(p => {
      this.ctx.globalAlpha = p.life;
      this.ctx.fillStyle = p.color;
      this.ctx.fillRect(p.x, p.y, 4, 4);
    });
  }
}
```

### Web Audio API — ⭐⭐⭐⭐（中高可行）

**用途**：

- ✅ 環境音（辦公室背景音）
- ✅ 事件音效（完成、錯誤、訊息）
- ✅ BGM 播放與淡入淡出
- ⚠️ 3D 空間音效（可選）

**限制**：

- ❌ 需要使用者互動才能初始化（瀏覽器限制）
- ❌ 音訊檔案需要預載入

**實現範例**：

```javascript
class SoundManager {
  constructor() {
    this.context = new AudioContext();
    this.sounds = new Map();
    this.bgm = null;
  }
  
  async load(name, url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await this.context.decodeAudioData(arrayBuffer);
    this.sounds.set(name, audioBuffer);
  }
  
  play(name, volume = 1.0) {
    const buffer = this.sounds.get(name);
    if (!buffer) return;
    
    const source = this.context.createBufferSource();
    const gainNode = this.context.createGain();
    
    source.buffer = buffer;
    gainNode.gain.value = volume;
    
    source.connect(gainNode);
    gainNode.connect(this.context.destination);
    source.start(0);
  }
  
  playBGM(name, volume = 0.3) {
    if (this.bgm) this.bgm.stop();
    
    const buffer = this.sounds.get(name);
    const source = this.context.createBufferSource();
    const gainNode = this.context.createGain();
    
    source.buffer = buffer;
    source.loop = true;
    gainNode.gain.value = volume;
    
    source.connect(gainNode);
    gainNode.connect(this.context.destination);
    source.start(0);
    
    this.bgm = source;
  }
}
```

### WebGL — ⭐⭐（低可行）

**原因**：

- ❌ 複雜度高（學習曲線陡峭）
- ❌ ClaudeCab 不需要 3D 渲染
- ✅ 可用 Canvas 2D 滿足需求

**建議**：不採用 WebGL，CSS + Canvas 已足夠

---

## 開源專案/Library 可用資源

### 推薦 Library

| Library | 用途 | 可行性 | 大小 |
|---------|------|--------|------|
| **anime.js** | JS 動畫引擎 | ⭐⭐⭐⭐⭐ | 17KB |
| **Particles.js** | 粒子背景 | ⭐⭐⭐⭐ | 15KB |
| **Howler.js** | Web Audio 簡化 | ⭐⭐⭐⭐⭐ | 20KB |
| **Chart.js** | 統計圖表 | ⭐⭐⭐⭐ | 60KB |
| **GSAP** | 專業動畫 | ⭐⭐⭐ | 50KB（較重） |

**建議**：

- ✅ 採用 **anime.js**（輕量、強大）
- ✅ 採用 **Howler.js**（簡化 Web Audio）
- ⚠️ Particles.js 可選（純 CSS 也能實現）
- ❌ 不採用 GSAP（太重，CSS 已足夠）

---

## 效能考量與快取策略

### 效能瓶頸分析

**潛在瓶頸**：

1. **SSE 連線數**：
   - 單一伺服器支援 ~1000 併發 SSE
   - ClaudeCab 單人使用，無問題

2. **Portrait 圖片載入**：
   - 4:3 高解析度 PNG 可能 200-500KB
   - 需要預載入 + 模糊圖佔位

3. **Canvas 粒子數量**：
   - 超過 100 個粒子會影響 FPS
   - 限制單次爆發 20-30 個

4. **Memory 檔案讀取**：
   - `memory/*.md` 可能累積很多
   - 需要分頁或限制載入範圍

### 快取策略

**1. Portrait 預載入**：

```javascript
// 頁面載入時預載入所有 portrait
async function preloadPortraits() {
  const portraits = Object.values(agentCards).map(a => a.portrait);
  const promises = portraits.map(src => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = resolve;
      img.src = src;
    });
  });
  await Promise.all(promises);
}
```

**2. 音效預載入**：

```javascript
// 初始化時預載入常用音效
const PRELOAD_SOUNDS = [
  'complete',
  'error',
  'message',
  'levelup'
];

async function preloadSounds() {
  for (const name of PRELOAD_SOUNDS) {
    await SoundManager.load(name, `/sounds/${name}.mp3`);
  }
}
```

**3. Memory 分頁載入**：

```javascript
// 只載入最近 30 天的 memory
async function loadRecentMemories(agentId, days = 30) {
  const memories = [];
  const today = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    try {
      const content = await readFile(`agents/${agentId}/memory/${dateStr}.md`);
      memories.push({ date: dateStr, content });
    } catch (err) {
      // 檔案不存在，跳過
    }
  }
  
  return memories;
}
```

**4. LocalStorage 快取**：

```javascript
// 快取 agent 狀態（減少 API 呼叫）
function cacheAgentState(agentId, state) {
  const key = `agent-state-${agentId}`;
  localStorage.setItem(key, JSON.stringify({
    state,
    timestamp: Date.now()
  }));
}

function getCachedAgentState(agentId, maxAge = 60000) { // 1 min
  const key = `agent-state-${agentId}`;
  const cached = localStorage.getItem(key);
  if (!cached) return null;
  
  const { state, timestamp } = JSON.parse(cached);
  if (Date.now() - timestamp > maxAge) return null;
  
  return state;
}
```

---

## 總結：技術實現建議

### 優先實現（低風險、高價值）

1. ✅ **CSS 動畫增強**：
   - 進場動畫、呼吸效果、粒子爆發
   - 使用 anime.js 簡化複雜動畫

2. ✅ **SSE 事件類型擴展**：
   - agent_chat, affinity_change, achievement, random_event
   - 前端對應處理邏輯

3. ✅ **Database Schema 擴展**：
   - agent_affinity, achievements, cg_collection 表
   - Migration script

4. ✅ **音效系統（可選）**：
   - Howler.js + 5-10 個基礎音效
   - 環境音 + 事件音效

### 中期開發

1. ⚙️ **Scheduler 擴展**：
   - DailyRoutineScheduler
   - SocialInteractionScheduler
   - MoodRecoveryScheduler

2. ⚙️ **Memory 系統升級**：
   - 結構化 markdown
   - 動態記憶注入
   - Knowledge Graph

3. ⚙️ **Canvas 粒子系統**：
   - 慶祝粒子、漂浮灰塵
   - 關係網絡連線

### 長期願景

1. 🎯 **完整遊戲化系統**：
   - XP/Level, Achievement, Streak, CG
   - 資料庫完整追蹤

2. 🎯 **深度記憶整合**：
   - 記憶搜尋引擎
   - 自動摘要與分類
   - 可視化時間軸

3. 🎯 **多 Agent 互動**：
   - Agent 之間即時對話
   - 關係網絡可視化
   - 團隊故事線
