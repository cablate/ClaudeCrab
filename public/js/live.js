/**
 * ClaudeCab Live — Virtual Office (v4.0)
 */

// --- State ---
const agentCards = {};
const activityFeed = [];
const MAX_FEED_ITEMS = 50;
let activeFilter = 'all'; // 'all' | 'workflow' | 'personality' | 'agent:{id}'

// --- Seat positions (% of scene width/height) ---
// Mapped to the isometric office background desk/chair positions
const SEAT_POSITIONS = [
  { left: '56%', top: '61%' },          // desk front-right
  { left: '26%', top: '35%' },          // desk back-left
  { left: '77%', top: '42%' },          // cozy corner
  { left: '45%', top: '52%', flip: true }, // desk center (flipped)
  { left: '65%', top: '33%' },          // desk back-right
];

const SEAT_STORAGE_KEY = 'claudecab-seat-assignments';

/**
 * Get or create seat assignments for agents.
 * Persists to localStorage so agents keep their seats across reloads.
 * @param {string[]} agentIds - Current agent IDs from API
 * @returns {Object<string, {left:string, top:string, flip?:boolean}|null>} agentId → position (null if overflow)
 */
function getSeatAssignments(agentIds) {
  // Load existing assignments
  let saved = {};
  try {
    const raw = localStorage.getItem(SEAT_STORAGE_KEY);
    if (raw) saved = JSON.parse(raw);
  } catch { /* ignore corrupt data */ }

  // Remove agents that no longer exist
  const activeSet = new Set(agentIds);
  for (const id of Object.keys(saved)) {
    if (!activeSet.has(id)) delete saved[id];
  }

  // Find which seat indices are already taken
  const usedIndices = new Set(Object.values(saved));
  const availableIndices = [];
  for (let i = 0; i < SEAT_POSITIONS.length; i++) {
    if (!usedIndices.has(i)) availableIndices.push(i);
  }

  // Assign unassigned agents to available seats
  for (const id of agentIds) {
    if (saved[id] === undefined) {
      if (availableIndices.length > 0) {
        saved[id] = availableIndices.shift();
      } else {
        saved[id] = null; // overflow — will use fallback grid
      }
    }
  }

  // Persist
  try {
    localStorage.setItem(SEAT_STORAGE_KEY, JSON.stringify(saved));
  } catch { /* storage full, non-critical */ }

  // Map to actual positions
  const result = {};
  for (const id of agentIds) {
    const idx = saved[id];
    result[id] = idx !== null && idx < SEAT_POSITIONS.length ? SEAT_POSITIONS[idx] : null;
  }
  return result;
}

// Phase → mood fallback (when no mood match in emoji set, try phase's default mood)
const PHASE_TO_MOOD = {
  idle: 'neutral', working: 'focused', tool_use: 'focused',
  task_received: 'task_received', completed: 'excited', error: 'annoyed',
};

// Pick emoji key: mood first, then phase→mood fallback, then neutral
function pickEmojiKey(emojiSet, mood, phase) {
  if (!emojiSet) return null;
  if (mood && emojiSet[mood]) return mood;
  const fallback = PHASE_TO_MOOD[phase];
  if (fallback && emojiSet[fallback]) return fallback;
  if (emojiSet.neutral) return 'neutral';
  const keys = Object.keys(emojiSet);
  return keys.length > 0 ? keys[0] : null;
}

// Mood emoji mapping
const MOOD_EMOJI = {
  neutral: '😐',
  excited: '😆',
  annoyed: '😤',
  tired: '😩',
  focused: '🧐',
  bored: '😪',
};

// Phase status mapping
const PHASE_STATUS = {
  task_received: { label: '收到任務', class: 'status-working' },
  working: { label: '工作中', class: 'status-working' },
  tool_use: { label: '使用工具', class: 'status-working' },
  completed: { label: '完成', class: 'status-idle' },
  error: { label: '出錯', class: 'status-error' },
  idle: { label: '休息中', class: 'status-idle' },
};

// Workflow phase icons + labels (for feed entries)
const WORKFLOW_ICONS = {
  task_received: '📩',
  working: '⚡',
  tool_use: '🔧',
  completed: '✅',
  error: '❌',
  idle: '💤',
};

const WORKFLOW_LABELS = {
  task_received: '收到任務',
  working: '處理中',
  tool_use: '使用工具',
  completed: '回覆完成',
  error: '發生錯誤',
  idle: '進入休息',
};

// --- Initialize ---
// --- Fill initial bubbles from loaded feed data ---
function populateInitialBubbles() {
  const latestByAgent = {};
  for (const event of activityFeed) {
    if (event.type !== 'workflow' && event.agentId && event.message) {
      if (!latestByAgent[event.agentId]) {
        latestByAgent[event.agentId] = event.message;
      }
    }
  }
  const sprites = document.querySelectorAll('.agent-sprite');
  for (const sprite of sprites) {
    const agentId = sprite.id.replace('sprite-', '');
    const text = latestByAgent[agentId] || defaultBubble();
    showSpriteBubble(sprite, text);
  }
}

async function init() {
  await loadAgentStates();
  await loadRecentFeed();
  populateInitialBubbles();
  connectSSE();
  startRelativeTimeUpdater();
  startIdleBadgeUpdater();
  startClock();
  startStatsPoller();
  initFilters();
  updateStats();
  updatePageTitle();
}

// --- Load initial agent states ---
async function loadAgentStates() {
  try {
    const res = await fetch('/api/activity/agents');
    const { agents } = await res.json();
    const container = document.getElementById('agent-cards');
    container.innerHTML = '';
    if (agents.length === 0) {
      // Show empty state in office scene
      const scene = document.getElementById('office-scene');
      if (scene) {
        const empty = document.createElement('div');
        empty.className = 'scene-empty-state';
        empty.innerHTML = '<div class="icon">🏢</div><p>尚未有員工進駐</p>';
        scene.appendChild(empty);
      }
      return;
    }
    // Assign seats (persisted in localStorage)
    const seatMap = getSeatAssignments(agents.map(a => a.id));

    // Fallback grid for overflow agents
    const overflowSeats = [
      { left: '20%', top: '45%' }, { left: '35%', top: '45%' },
      { left: '50%', top: '45%' }, { left: '65%', top: '45%' },
      { left: '80%', top: '45%' }, { left: '35%', top: '65%' },
      { left: '50%', top: '65%' }, { left: '65%', top: '65%' },
    ];
    let overflowIdx = 0;

    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      const card = createAgentCard(agent);
      container.appendChild(card);
      agentCards[agent.id] = agent;

      // Create sprite with assigned seat or overflow fallback
      const pos = seatMap[agent.id] || (overflowIdx < overflowSeats.length ? overflowSeats[overflowIdx++] : null);
      if (pos) {
        createAgentSprite(agent, pos);
      }
    }
  } catch (err) {
    console.error('Failed to load agent states:', err);
  }
}

// --- SSE Connection ---
let sseRetryDelay = 1000;
const SSE_MAX_RETRY_DELAY = 30000;

function connectSSE() {
  const source = new EventSource('/api/activity/stream');
  let isInitialBatch = true;

  setTimeout(() => { isInitialBatch = false; }, 2000);

  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      if (isInitialBatch) {
        // Skip — loadRecentFeed() already loaded history from DB
        return;
      }
      handleActivityEvent(event);
    } catch (err) {
      console.error('Failed to parse SSE event:', err);
    }
  };

  source.onerror = () => {
    console.warn(`SSE connection lost, reconnecting in ${sseRetryDelay / 1000}s...`);
    source.close();

    const dot = document.getElementById('connection-dot');
    if (dot) dot.classList.remove('connected');

    setTimeout(connectSSE, sseRetryDelay);
    sseRetryDelay = Math.min(sseRetryDelay * 2, SSE_MAX_RETRY_DELAY);
  };

  const dot = document.getElementById('connection-dot');
  if (dot) dot.classList.add('connected');
  source.addEventListener('open', () => {
    if (dot) dot.classList.add('connected');
    sseRetryDelay = 1000;
  });
}

// --- Handle incoming activity event ---
function handleActivityEvent(event) {
  updateAgentCard(event);
  updateSpriteStatus(event);

  // Skip status_change and auto-idle workflow events from feed
  const isAutoIdle = event.type === 'workflow' && event.phase === 'idle';
  if (event.type !== 'status_change' && !isAutoIdle) {
    addToFeed(event, true);
  }

  updateStats();
  updatePageTitle();
}

// --- Default bubble text based on time of day ---
function defaultBubble() {
  const h = new Date().getHours();
  if (h < 6) return '深夜了...還沒睡';
  if (h < 9) return '早安，又是新的一天';
  if (h < 12) return '上午好...';
  if (h < 14) return '午餐時間到了嗎';
  if (h < 18) return '下午了啊...';
  if (h < 22) return '晚上好...';
  return '夜深了...';
}

// --- Load recent feed history from DB ---
async function loadRecentFeed() {
  try {
    const res = await fetch('/api/activity/events?limit=20');
    const { events } = await res.json();
    const feed = document.getElementById('activity-feed');
    if (!feed || !events || events.length === 0) {
      showFeedEmpty();
      return;
    }
    // Events come newest-first, render in order (newest on top)
    for (const event of events) {
      const isAutoIdle = event.type === 'workflow' && event.phase === 'idle';
      if (event.type !== 'status_change' && !isAutoIdle) {
        addToFeed(event, false);
      }
    }
  } catch (err) {
    console.error('Failed to load recent feed:', err);
    showFeedEmpty();
  }
}

function showFeedEmpty() {
  const feed = document.getElementById('activity-feed');
  if (!feed || feed.children.length > 0) return;
  feed.innerHTML = '<div class="feed-empty">暫無動態</div>';
}

function clearFeedEmpty() {
  const el = document.querySelector('.feed-empty');
  if (el) el.remove();
}

// --- Format idle duration ---
function formatIdleDuration(ms) {
  if (ms === Infinity || ms === undefined || ms === null) return '尚未上線';
  if (ms < 60000) return '剛剛活躍';
  if (ms < 3600000) return `休息 ${Math.floor(ms / 60000)} 分鐘`;
  if (ms < 86400000) return `休息 ${Math.floor(ms / 3600000)} 小時`;
  return `休息 ${Math.floor(ms / 86400000)} 天`;
}

// --- Truncate description for card display ---
function truncateDescription(text, maxLen) {
  if (!text || text.length <= maxLen) return text || '';
  return text.substring(0, maxLen) + '...';
}

// --- Create agent card (v3.0 — employee profile style) ---
function createAgentCard(agent) {
  const card = document.createElement('div');
  card.className = 'agent-card';
  card.id = `agent-${agent.id}`;
  card.style.setProperty('--agent-color', agent.color || '#6B7280');

  const phase = agent.phase || 'idle';
  const mood = agent.mood || 'neutral';
  const statusInfo = PHASE_STATUS[phase] || PHASE_STATUS.idle;
  const modelLabel = (agent.model || 'unknown').toUpperCase();
  const roleDesc = truncateDescription(agent.description, 60);

  card.innerHTML = `
    <div class="agent-header">
      <div class="agent-avatar-large">${agent.avatar || '🤖'}</div>
      <div class="agent-info">
        <div class="agent-name">${agent.name}</div>
        <div class="agent-role">${escapeHtml(roleDesc) || 'AI Assistant'}</div>
      </div>
    </div>
    <div class="agent-meta">
      <span class="meta-badge meta-model">${modelLabel}</span>
      <span class="meta-badge meta-idle">${formatIdleDuration(agent.idleDuration)}</span>
    </div>
    <div class="agent-status-row">
      <span class="agent-mood-large">${MOOD_EMOJI[mood] || ''}</span>
      <div class="agent-status ${statusInfo.class}">${statusInfo.label}</div>
    </div>
    <div class="agent-task" style="display: none;"></div>
    <div class="agent-bubble">
      <span class="bubble-text">${agent.lastEvent?.message || defaultBubble()}</span>
    </div>
  `;

  if (phase === 'idle') {
    card.classList.add('breathing');
  }

  return card;
}

// --- Update agent card with new event ---
function updateAgentCard(event) {
  const card = document.getElementById(`agent-${event.agentId}`);
  if (!card) return;

  const phase = event.phase || 'idle';
  const mood = event.mood || 'neutral';
  const statusInfo = PHASE_STATUS[phase] || PHASE_STATUS.idle;

  // Sync in-memory state for portrait modal
  if (agentCards[event.agentId]) {
    agentCards[event.agentId].phase = phase;
    if (event.mood) agentCards[event.agentId].mood = mood;
  }

  // Update status
  const statusEl = card.querySelector('.agent-status');
  if (statusEl) {
    statusEl.textContent = statusInfo.label;
    statusEl.className = `agent-status ${statusInfo.class}`;
  }

  // Update mood (large)
  const moodEl = card.querySelector('.agent-mood-large');
  if (moodEl) {
    moodEl.textContent = MOOD_EMOJI[mood] || '';
  }

  // Update idle badge — reset to "active now" on any event
  const idleEl = card.querySelector('.meta-idle');
  if (idleEl) {
    idleEl.textContent = '剛剛活躍';
  }

  // Update current task display — persist during working phases
  const taskEl = card.querySelector('.agent-task');
  if (taskEl) {
    if (event.type === 'workflow' && event.phase === 'task_received' && event.metadata?.taskContent) {
      const preview = String(event.metadata.taskContent);
      const truncated = preview.length > 50 ? preview.substring(0, 50) + '...' : preview;
      taskEl.textContent = truncated;
      taskEl.style.display = 'block';
      // Remember current task
      if (agentCards[event.agentId]) agentCards[event.agentId].currentTask = truncated;
    } else if (event.phase === 'completed' || event.phase === 'idle') {
      taskEl.style.display = 'none';
      if (agentCards[event.agentId]) agentCards[event.agentId].currentTask = null;
    } else if (agentCards[event.agentId]?.currentTask) {
      // working / tool_use — keep showing the task
      taskEl.textContent = agentCards[event.agentId].currentTask;
      taskEl.style.display = 'block';
    }
  }

  // Update bubble: personality events use typewriter, workflow events skip bubble
  if (event.type !== 'workflow') {
    const bubbleText = card.querySelector('.bubble-text');
    if (bubbleText && event.message) {
      typewriterEffect(bubbleText, event.message);
    }
  }

  // Breathing animation
  if (phase === 'idle') {
    card.classList.add('breathing');
  } else {
    card.classList.remove('breathing');
  }

  // Flash effect
  card.classList.add('flash');
  setTimeout(() => card.classList.remove('flash'), 600);

  // Sync portrait overlay if open for this agent
  updatePortraitIfOpen(event.agentId);
}

// --- Typewriter effect ---
const activeTypewriters = new WeakMap();

function typewriterEffect(el, text) {
  const prev = activeTypewriters.get(el);
  if (prev) clearTimeout(prev);

  el.textContent = '';
  let i = 0;
  const speed = 30;
  function type() {
    if (i < text.length) {
      el.textContent += text.charAt(i);
      i++;
      const timer = setTimeout(type, speed);
      activeTypewriters.set(el, timer);
    } else {
      activeTypewriters.delete(el);
    }
  }
  type();
}

// --- Add event to activity feed (v3.0 — enhanced) ---
function addToFeed(event, animate) {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;
  clearFeedEmpty();

  const item = document.createElement('div');
  const isWorkflow = event.type === 'workflow';
  item.className = `feed-item ${isWorkflow ? 'feed-workflow' : 'feed-personality'} ${animate ? 'feed-enter' : ''}`;
  item.dataset.timestamp = event.timestamp;
  item.dataset.eventType = isWorkflow ? 'workflow' : 'personality';
  item.dataset.agentId = event.agentId || '';

  if (!matchesFilter(item)) {
    item.style.display = 'none';
  }

  const agentState = agentCards[event.agentId] || {};
  const avatar = agentState.avatar || '';
  const color = agentState.color || '#6B7280';
  const name = event.agentName || event.agentId;

  if (isWorkflow) {
    const phaseIcon = WORKFLOW_ICONS[event.phase] || '▸';
    const label = WORKFLOW_LABELS[event.phase] || event.message;
    const toolBadge = event.metadata?.toolName
      ? `<span class="tool-badge">${escapeHtml(String(event.metadata.toolName))}</span>`
      : '';
    // For task_received, show truncated task content
    let detail = '';
    if (event.phase === 'task_received' && event.metadata?.taskContent) {
      const content = String(event.metadata.taskContent);
      detail = `「${escapeHtml(content.length > 30 ? content.substring(0, 30) + '...' : content)}」`;
    }
    item.innerHTML = `
      <span class="feed-workflow-icon">${phaseIcon}</span>
      <span class="feed-avatar">${avatar}</span>
      <span class="feed-name" style="color: ${color}">${name}</span>
      ${toolBadge}
      <span class="feed-workflow-message">${label}${detail ? ' ' + detail : ''}</span>
      <span class="feed-time">${relativeTime(event.timestamp)}</span>
    `;
  } else {
    const typeIcon = event.type === 'mutter' ? '💭' : '💬';
    item.innerHTML = `
      <span class="feed-type-icon">${typeIcon}</span>
      <span class="feed-avatar" style="color: ${color}">${avatar}</span>
      <span class="feed-name" style="color: ${color}">${name}</span>
      <span class="feed-message">${escapeHtml(event.message)}</span>
      <span class="feed-time">${relativeTime(event.timestamp)}</span>
    `;
  }

  feed.prepend(item);

  while (feed.children.length > MAX_FEED_ITEMS) {
    feed.removeChild(feed.lastChild);
  }

  activityFeed.unshift(event);
  if (activityFeed.length > MAX_FEED_ITEMS) {
    activityFeed.pop();
  }
}

// --- Stats (from DB API) ---
let statsDebounceTimer = null;

function updateStats() {
  // Debounce: don't hammer API on rapid events
  if (statsDebounceTimer) clearTimeout(statsDebounceTimer);
  statsDebounceTimer = setTimeout(fetchStats, 1000);
}

async function fetchStats() {
  try {
    const res = await fetch('/api/activity/stats');
    const data = await res.json();

    const elMsg = document.getElementById('stat-messages');
    const elCompleted = document.getElementById('stat-completed');
    const elPersonality = document.getElementById('stat-personality');
    if (elMsg) elMsg.textContent = data.messagesHandled || 0;
    if (elCompleted) elCompleted.textContent = data.tasksCompleted || 0;
    if (elPersonality) elPersonality.textContent = data.personality || 0;
  } catch (err) {
    console.error('Failed to fetch stats:', err);
  }
}

// --- Utility functions ---
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function relativeTime(timestamp) {
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 10) return '剛剛';
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
  return new Date(timestamp).toLocaleDateString('zh-TW');
}

function startRelativeTimeUpdater() {
  setInterval(() => {
    document.querySelectorAll('.feed-time').forEach(el => {
      const item = el.closest('.feed-item');
      if (item && item.dataset.timestamp) {
        el.textContent = relativeTime(item.dataset.timestamp);
      }
    });
  }, 10000);
}

// --- Clock ---
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function startClock() {
  updateClock();
  setInterval(updateClock, 60000);
}

function updateClock() {
  const el = document.getElementById('header-clock');
  if (!el) return;
  const now = new Date();
  const day = WEEKDAYS[now.getDay()];
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  el.textContent = `週${day} ${h}:${m}`;
}

// --- Idle badge auto-updater (every 60s) ---
function startIdleBadgeUpdater() {
  setInterval(() => {
    for (const [id, agent] of Object.entries(agentCards)) {
      const card = document.getElementById(`agent-${id}`);
      if (!card) continue;
      const idleEl = card.querySelector('.meta-idle');
      if (!idleEl) continue;
      // Increment idle duration by 60s if agent is idle
      if (agent.phase === 'idle' || !agent.phase) {
        agent.idleDuration = (agent.idleDuration || 0) + 60000;
        idleEl.textContent = formatIdleDuration(agent.idleDuration);
      }
    }
  }, 60000);
}

// --- Stats periodic poll (every 30s) ---
function startStatsPoller() {
  setInterval(fetchStats, 30000);
}

// --- Dynamic page title ---
function updatePageTitle() {
  const active = Object.values(agentCards).filter(a => a.phase && a.phase !== 'idle' && a.phase !== 'completed').length;
  const total = Object.keys(agentCards).length;
  if (active > 0) {
    document.title = `ClaudeCab Live (${active} 工作中)`;
  } else {
    document.title = `ClaudeCab Live (${total} 員工)`;
  }
}

// --- Filters ---
function initFilters() {
  const container = document.getElementById('feed-filters');
  if (!container) return;

  const agentIds = Object.keys(agentCards);
  for (const id of agentIds) {
    const agent = agentCards[id];
    const btn = document.createElement('button');
    btn.className = 'filter-btn filter-agent';
    btn.dataset.filter = `agent:${id}`;
    btn.textContent = agent.avatar ? `${agent.avatar} ${agent.name}` : agent.name;
    btn.style.setProperty('--agent-color', agent.color || '#6B7280');
    container.appendChild(btn);
  }

  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    applyFilter();
  });
}

function matchesFilter(item) {
  if (activeFilter === 'all') return true;
  if (activeFilter === 'workflow') return item.dataset.eventType === 'workflow';
  if (activeFilter === 'personality') return item.dataset.eventType === 'personality';
  if (activeFilter.startsWith('agent:')) return item.dataset.agentId === activeFilter.slice(6);
  return true;
}

function applyFilter() {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;
  for (const item of feed.children) {
    item.style.display = matchesFilter(item) ? '' : 'none';
  }
}

// ============================================
// OFFICE SCENE — Sprites + Portrait Modal
// ============================================

// --- Create sprite in office scene ---
function createAgentSprite(agent, pos) {
  const scene = document.getElementById('office-scene');
  if (!scene || !pos) return;

  const sprite = document.createElement('div');
  sprite.className = 'agent-sprite breathing';
  sprite.id = `sprite-${agent.id}`;
  sprite.style.left = pos.left;
  sprite.style.top = pos.top;
  if (pos.flip) {
    sprite.dataset.flip = 'true';
  }

  const spriteSrc = agent.sprite || '';
  const mood = agent.mood || 'neutral';
  const moodEmoji = MOOD_EMOJI[mood] || '😐';
  const lastMsg = agent.lastEvent?.message || '';

  // Sprite: use image if available, otherwise show avatar emoji as fallback
  const spriteContent = spriteSrc
    ? `<img src="${spriteSrc}" alt="${agent.name}" onerror="this.parentElement.querySelector('.sprite-fallback').style.display='flex';this.style.display='none'" class="${pos.flip ? 'flipped' : ''}"><span class="sprite-fallback" style="display:none;font-size:2.5rem;width:100%;height:100%;align-items:center;justify-content:center">${agent.avatar || '🤖'}</span>`
    : `<span class="sprite-fallback" style="font-size:2.5rem;width:100%;height:100%;display:flex;align-items:center;justify-content:center">${agent.avatar || '🤖'}</span>`;

  sprite.innerHTML = `
    ${spriteContent}
    <span class="sprite-label">${agent.name}</span>
    <span class="sprite-mood">${moodEmoji}</span>
    <div class="sprite-bubble ${lastMsg ? 'visible' : ''}">${lastMsg.length > 40 ? lastMsg.substring(0, 40) + '...' : lastMsg}</div>
  `;

  sprite.addEventListener('click', () => openPortrait(agent));
  scene.appendChild(sprite);
}

// --- Update sprite status from event ---
function updateSpriteStatus(event) {
  const sprite = document.getElementById(`sprite-${event.agentId}`);
  if (!sprite) return;

  const phase = event.phase || 'idle';

  // Breathing vs working pulse animation
  if (phase === 'idle' || phase === 'completed') {
    sprite.classList.add('breathing');
    sprite.classList.remove('working-pulse');
  } else {
    sprite.classList.remove('breathing');
    if (phase !== 'error') {
      sprite.classList.add('working-pulse');
    } else {
      sprite.classList.remove('working-pulse');
    }
  }

  // Update mood emoji
  if (event.mood) {
    const moodEl = sprite.querySelector('.sprite-mood');
    if (moodEl) {
      moodEl.textContent = MOOD_EMOJI[event.mood] || '😐';
    }
  }

  // Update bubble — any non-workflow event with a message updates the bubble
  if (event.type !== 'workflow' && event.message) {
    showSpriteBubble(sprite, event.message);
  }
}

// --- Show persistent bubble above sprite ---
function showSpriteBubble(sprite, text) {
  const bubble = sprite.querySelector('.sprite-bubble');
  if (!bubble) return;
  bubble.textContent = text.length > 25 ? text.substring(0, 25) + '...' : text;
  bubble.classList.add('visible');
}

// --- Portrait modal state ---
let portraitOpenAgentId = null;

/** Update portrait overlay in real-time if it's open for this agent */
function updatePortraitIfOpen(agentId) {
  if (!portraitOpenAgentId || portraitOpenAgentId !== agentId) return;
  const overlay = document.getElementById('dialogue-overlay');
  if (!overlay || overlay.style.display === 'none') return;

  const currentAgent = agentCards[agentId];
  if (!currentAgent) return;

  const phase = currentAgent.phase || 'idle';
  const mood = currentAgent.mood || 'neutral';

  // Update status
  const statusInfo = PHASE_STATUS[phase] || PHASE_STATUS.idle;
  const statusEl = document.getElementById('dialogue-status');
  if (statusEl) statusEl.textContent = statusInfo.label;

  // Update emoji
  const emojiEl = document.getElementById('dialogue-emoji');
  const emojiSet = currentAgent.emoji;
  if (emojiEl) {
    if (emojiSet && typeof emojiSet === 'object') {
      const emojiKey = pickEmojiKey(emojiSet, mood, phase);
      if (emojiKey && emojiSet[emojiKey]) {
        emojiEl.innerHTML = `<img src="${emojiSet[emojiKey]}" alt="emoji">`;
      } else {
        emojiEl.innerHTML = `<span style="font-size:4rem">${MOOD_EMOJI[mood] || '😐'}</span>`;
      }
    } else {
      emojiEl.innerHTML = `<span style="font-size:4rem">${MOOD_EMOJI[mood] || '😐'}</span>`;
    }
  }

  // Update dialogue text from latest feed
  const agentEvents = activityFeed.filter(e => e.agentId === agentId && e.message);
  if (agentEvents.length > 0) {
    const textEl = document.getElementById('dialogue-text');
    if (textEl) textEl.textContent = agentEvents[0].message;

    // Update history
    const historyEl = document.getElementById('dialogue-history');
    if (historyEl) {
      const olderEvents = agentEvents.slice(1, 8);
      historyEl.innerHTML = olderEvents.map(e =>
        `<div class="dialogue-history-item">${escapeHtml(e.message)}<span class="history-time">${relativeTime(e.timestamp)}</span></div>`
      ).join('');
    }
  }
}

// --- Open portrait modal ---
function openPortrait(agent) {
  const overlay = document.getElementById('dialogue-overlay');
  if (!overlay) return;

  portraitOpenAgentId = agent.id;
  const currentAgent = agentCards[agent.id] || agent;

  // Portrait image (from API data, with fallback)
  const portraitImg = document.getElementById('dialogue-portrait-img');
  if (currentAgent.portrait) {
    portraitImg.src = currentAgent.portrait;
    portraitImg.style.display = '';
  } else {
    portraitImg.style.display = 'none';
  }

  // Name plate
  document.getElementById('dialogue-name').textContent = currentAgent.name || agent.name;
  const phase = currentAgent.phase || 'idle';
  const statusInfo = PHASE_STATUS[phase] || PHASE_STATUS.idle;
  document.getElementById('dialogue-status').textContent = statusInfo.label;

  // Latest monologue (main dialogue text)
  const agentEvents = activityFeed.filter(e => e.agentId === agent.id && e.message);
  const latestMsg = agentEvents.length > 0 ? agentEvents[0].message : defaultBubble();
  document.getElementById('dialogue-text').textContent = latestMsg;

  // Character emoji — pick from emoji set based on mood/phase
  const emojiEl = document.getElementById('dialogue-emoji');
  const emojiSet = currentAgent.emoji;
  if (emojiSet && typeof emojiSet === 'object') {
    const mood = currentAgent.mood || 'neutral';
    const emojiKey = pickEmojiKey(emojiSet, mood, phase);
    if (emojiKey && emojiSet[emojiKey]) {
      emojiEl.innerHTML = `<img src="${emojiSet[emojiKey]}" alt="emoji">`;
    } else {
      const moodEmoji = MOOD_EMOJI[mood] || '😐';
      emojiEl.innerHTML = `<span style="font-size:4rem">${moodEmoji}</span>`;
    }
  } else {
    // Fallback: show mood emoji as text
    const mood = currentAgent.mood || 'neutral';
    const moodEmoji = MOOD_EMOJI[mood] || '😐';
    emojiEl.innerHTML = `<span style="font-size:4rem">${moodEmoji}</span>`;
  }

  // Recent thoughts history
  const historyEl = document.getElementById('dialogue-history');
  const olderEvents = agentEvents.slice(1, 8);
  if (olderEvents.length > 0) {
    historyEl.innerHTML = olderEvents.map(e =>
      `<div class="dialogue-history-item">${escapeHtml(e.message)}<span class="history-time">${relativeTime(e.timestamp)}</span></div>`
    ).join('');
  } else {
    historyEl.innerHTML = '';
  }

  overlay.style.display = 'flex';
}

// Close dialogue overlay
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('dialogue-backdrop') || e.target.classList.contains('dialogue-close')) {
    document.getElementById('dialogue-overlay').style.display = 'none';
    portraitOpenAgentId = null;
  }
});

// --- Start ---
document.addEventListener('DOMContentLoaded', init);
