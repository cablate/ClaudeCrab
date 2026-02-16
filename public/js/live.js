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
  { left: '45%', top: '52%' },             // desk center
  { left: '65%', top: '33%' },          // desk back-right
];

const SEAT_STORAGE_KEY = 'claudecab-seat-assignments';
const CUSTOM_POS_KEY = 'claudecab-sprite-custom-positions';

/**
 * Get or create seat assignments for agents.
 * Persists to localStorage so agents keep their seats across reloads.
 * @param {string[]} agentIds - Current agent IDs from API
 * @returns {Object<string, {left:string, top:string}|null>} agentId → position (null if overflow)
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
// --- Show/update sprite bubble ---
function showSpriteBubble(sprite, text, isMutter = false) {
  const bubble = sprite.querySelector('.sprite-bubble');
  if (!bubble) return;
  const truncated = text && text.length > 40 ? text.substring(0, 40) + '...' : (text || '');
  bubble.textContent = truncated;
  bubble.classList.toggle('mutter', !!isMutter);
  if (truncated) {
    bubble.classList.add('visible');
  } else {
    bubble.classList.remove('visible');
  }
}

// --- Party Roster ---

// Mood → bar color & width (0-100%)
const MOOD_BAR = {
  excited: { color: '#4ade80', width: 100 },
  focused: { color: '#60a5fa', width: 85 },
  neutral: { color: '#a78bfa', width: 60 },
  bored:   { color: '#fbbf24', width: 40 },
  annoyed: { color: '#f97316', width: 25 },
  tired:   { color: '#ef4444', width: 15 },
};

function createRoster() {
  const container = document.getElementById('party-roster');
  if (!container) return;
  container.innerHTML = '';

  for (const agent of Object.values(agentCards)) {
    const card = document.createElement('div');
    card.className = 'roster-card';
    card.id = `roster-${agent.id}`;
    card.style.setProperty('--agent-color', agent.color || '#6B7280');
    card.addEventListener('click', () => openPortrait(agent));

    const isWorking = agent.phase && agent.phase !== 'idle' && agent.phase !== 'completed';
    if (isWorking) card.classList.add('working');

    const avatarSrc = agent.portrait || null;
    const avatarFallback = agent.avatar || '🤖';
    const moodEmoji = MOOD_EMOJI[agent.mood] || MOOD_EMOJI.neutral;
    const moodBar = MOOD_BAR[agent.mood] || MOOD_BAR.neutral;
    const statusInfo = PHASE_STATUS[agent.phase] || PHASE_STATUS.idle;
    const statusText = isWorking ? statusInfo.label : formatIdleDuration(agent.idleDuration);
    const statusClass = isWorking ? 'is-working' : (agent.phase === 'error' ? 'is-error' : '');
    const roleEmoji = agent.avatar || '🤖';

    card.innerHTML = `
      <div class="roster-frame">
        <div class="roster-diamond">
          ${avatarSrc
            ? `<img src="${avatarSrc}" alt="${agent.name}">`
            : `<span class="roster-diamond-emoji">${avatarFallback}</span>`}
        </div>
        <span class="roster-role">${roleEmoji}</span>
        <span class="roster-mood">${moodEmoji}</span>
      </div>
      <div class="roster-info">
        <div class="roster-name">${agent.name}</div>
      </div>
      <div class="roster-mood-bar">
        <div class="roster-mood-bar-fill" style="width:${moodBar.width}%;background:${moodBar.color}"></div>
      </div>
      <div class="roster-status-text ${statusClass}">${statusText}</div>
    `;
    container.appendChild(card);
  }
}

function updateRosterCard(agentId) {
  const card = document.getElementById(`roster-${agentId}`);
  const agent = agentCards[agentId];
  if (!card || !agent) return;

  const isWorking = agent.phase && agent.phase !== 'idle' && agent.phase !== 'completed';
  card.classList.toggle('working', isWorking);

  const moodEl = card.querySelector('.roster-mood');
  if (moodEl) moodEl.textContent = MOOD_EMOJI[agent.mood] || MOOD_EMOJI.neutral;

  const barFill = card.querySelector('.roster-mood-bar-fill');
  const moodBar = MOOD_BAR[agent.mood] || MOOD_BAR.neutral;
  if (barFill) {
    barFill.style.width = moodBar.width + '%';
    barFill.style.background = moodBar.color;
  }

  const statusEl = card.querySelector('.roster-status-text');
  const statusInfo = PHASE_STATUS[agent.phase] || PHASE_STATUS.idle;
  if (statusEl) {
    statusEl.textContent = isWorking ? statusInfo.label : formatIdleDuration(agent.idleDuration);
    statusEl.className = `roster-status-text ${isWorking ? 'is-working' : (agent.phase === 'error' ? 'is-error' : '')}`;
  }
}

function populateInitialBubbles() {
  const latestByAgent = {};
  for (const event of activityFeed) {
    if (event.agentId && event.message && (event.type === 'mutter' || event.type === 'reaction' || event.type === 'reply')) {
      if (!latestByAgent[event.agentId]) {
        // Phase-aware: idle/completed agents skip stale reactions
        const agentState = agentCards[event.agentId];
        const phase = agentState?.phase || 'idle';
        const isWorking = phase !== 'idle' && phase !== 'completed';
        if (!isWorking && event.type === 'reaction') continue;
        latestByAgent[event.agentId] = event;
      }
    }
  }
  const sprites = document.querySelectorAll('.agent-sprite');
  for (const sprite of sprites) {
    const agentId = sprite.id.replace('sprite-', '');
    const event = latestByAgent[agentId];
    if (event) {
      const isThought = isInnerThought(event.type);
      const msg = isThought ? `（${event.message}）` : event.message;
      showSpriteBubble(sprite, msg, isThought);
    } else {
      showSpriteBubble(sprite, defaultBubble());
    }
  }
}

async function init() {
  await loadAgentStates();
  createRoster();
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
  initDialogueInput();

  // Day/night sky background
  updateSkyBackground();
  setInterval(updateSkyBackground, 60_000);
}

// --- Load initial agent states ---
async function loadAgentStates() {
  try {
    const res = await fetch('/api/activity/agents');
    const { agents } = await res.json();
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
    // Assign seats (persisted in localStorage), with custom position override
    const seatMap = getSeatAssignments(agents.map(a => a.id));
    const customPositions = getCustomPositions();

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
      agentCards[agent.id] = agent;

      // Create sprite: custom position > seat assignment > overflow fallback
      const pos = customPositions[agent.id] || seatMap[agent.id] || (overflowIdx < overflowSeats.length ? overflowSeats[overflowIdx++] : null);
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

  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
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
  // ADR-033: Interactive hooks (permission/question prompts)
  if (event.type === 'permission_request') {
    showPermissionPrompt(event);
    return;
  }
  if (event.type === 'question_request') {
    showQuestionPrompt(event);
    return;
  }

  syncAgentState(event);
  updateSpriteStatus(event);

  // Roster notification for personality events
  if (event.agentId && (event.type === 'mutter' || event.type === 'reaction' || event.type === 'reply')) {
    addRosterNotification(event.agentId);
  }

  // addToFeed stores all events + renders visible ones to sidebar
  addToFeed(event, true);

  // Portrait update AFTER feed so activityFeed has the latest event
  updatePortraitIfOpen(event.agentId);

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
    const res = await fetch('/api/activity/events?limit=50');
    const { events } = await res.json();
    const feed = document.getElementById('activity-feed');
    if (!feed || !events || events.length === 0) {
      showFeedEmpty();
      return;
    }
    // Events come newest-first from API; reverse so oldest is processed first.
    // storeEvent uses unshift, so last-processed (newest) ends up at [0].
    const ordered = [...events].reverse();
    for (const event of ordered) {
      addToFeed(event, false);
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

// --- Update agent card with new event ---
function syncAgentState(event) {
  const agentState = agentCards[event.agentId];
  if (!agentState) return;

  const phase = event.phase || 'idle';
  const mood = event.mood || 'neutral';

  // Sync phase & mood
  agentState.phase = phase;
  if (event.mood) agentState.mood = mood;

  // Reset idle duration on any event
  agentState.idleDuration = 0;

  // Track current task
  if (event.type === 'workflow' && event.phase === 'task_received' && event.metadata?.taskContent) {
    const preview = String(event.metadata.taskContent);
    agentState.currentTask = preview.length > 50 ? preview.substring(0, 50) + '...' : preview;
  } else if (event.phase === 'completed' || event.phase === 'idle') {
    agentState.currentTask = null;
  }

  updateRosterCard(event.agentId);
}

// --- Typewriter effect ---
const activeTypewriters = new WeakMap();

function typewriterEffect(el, text, speed = 30, { markdown = false } = {}) {
  const prev = activeTypewriters.get(el);
  if (prev) clearTimeout(prev);

  el.textContent = '';
  let i = 0;
  function type() {
    if (i < text.length) {
      el.textContent += text.charAt(i);
      i++;
      const timer = setTimeout(type, speed);
      activeTypewriters.set(el, timer);
    } else {
      activeTypewriters.delete(el);
      // After typewriter completes, render markdown if requested
      if (markdown) {
        el.innerHTML = renderSimpleMarkdown(text);
      }
    }
  }
  type();
}

// --- Add event to activity feed (v3.0 — enhanced) ---
// Store event in memory (data layer, no DOM)
function storeEvent(event) {
  activityFeed.unshift(event);
  if (activityFeed.length > MAX_FEED_ITEMS * 2) {
    activityFeed.pop();
  }
}

// Should this event appear in the sidebar feed DOM?
function isFeedVisible(event) {
  if (event.type === 'status_change') return false;
  if (event.type === 'workflow' && event.phase === 'idle') return false;
  return true;
}

function addToFeed(event, animate) {
  // Always store for backlog
  storeEvent(event);

  // Skip DOM for non-visible events
  if (!isFeedVisible(event)) return;

  const feed = document.getElementById('activity-feed');
  if (!feed) return;
  clearFeedEmpty();

  const item = document.createElement('div');
  const isWorkflow = event.type === 'workflow';
  const isReply = event.type === 'reply';
  const isThought = isInnerThought(event.type);
  item.className = `feed-item ${isWorkflow ? 'feed-workflow' : 'feed-personality'}${isThought ? ' feed-mutter' : ''}${isReply ? ' feed-reply' : ''} ${animate ? 'feed-enter' : ''}`;
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
  } else if (isReply) {
    const replyText = event.message.length > 60 ? event.message.substring(0, 60) + '...' : event.message;
    item.innerHTML = `
      <span class="feed-type-icon">💬</span>
      <span class="feed-avatar" style="color: ${color}">${avatar}</span>
      <span class="feed-name" style="color: ${color}">${name}</span>
      <span class="feed-message feed-reply-msg">${escapeHtml(replyText)}</span>
      <span class="feed-time">${relativeTime(event.timestamp)}</span>
    `;
  } else {
    const moodEmoji = MOOD_EMOJI[event.mood] || '';
    let taskContext = '';
    if (event.type === 'reaction' && event.metadata?.taskContent) {
      const content = String(event.metadata.taskContent);
      const truncated = content.length > 25 ? content.substring(0, 25) + '...' : content;
      taskContext = `<span class="feed-task-context">📋 ${escapeHtml(truncated)}</span>`;
    }
    item.innerHTML = `
      <span class="feed-type-icon">💭</span>
      <span class="feed-mood">${moodEmoji}</span>
      <span class="feed-avatar" style="color: ${color}">${avatar}</span>
      <span class="feed-name" style="color: ${color}">${name}</span>
      ${taskContext}
      <span class="feed-message">（${escapeHtml(event.message)}）</span>
      <span class="feed-time">${relativeTime(event.timestamp)}</span>
    `;
  }

  feed.prepend(item);

  while (feed.children.length > MAX_FEED_ITEMS) {
    feed.removeChild(feed.lastChild);
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

// Format a single event for dialogue display (portrait main text or history item)
function formatDialogueEvent(e, { truncate = true } = {}) {
  const type = e.type;
  if (type === 'workflow') {
    if (e.phase === 'task_received' && e.metadata?.taskContent) {
      const content = String(e.metadata.taskContent);
      const text = truncate && content.length > 60 ? content.substring(0, 60) + '...' : content;
      return { icon: '📩', text, cssClass: 'dialogue-user-msg', speed: 20 };
    }
    const label = WORKFLOW_LABELS[e.phase] || e.message;
    const phaseIcon = WORKFLOW_ICONS[e.phase] || '⚙️';
    return { icon: phaseIcon, text: label, cssClass: 'dialogue-workflow', speed: 15 };
  }
  if (type === 'reply') {
    return { icon: '💬', text: e.message, cssClass: 'dialogue-reply', speed: 20, markdown: true };
  }
  // mutter / reaction = inner thought
  return { icon: '💭', text: `（${e.message}）`, cssClass: 'dialogue-thought', speed: 35 };
}

// --- Utility functions ---
function isInnerThought(type) {
  return type === 'mutter' || type === 'reaction';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Lightweight markdown renderer for dialogue text.
 * Supports: line breaks, **bold**, bullet lists (- / *), numbered lists, headings (#),
 * checkboxes (✅/❌), inline code (`code`).
 */
function renderSimpleMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Headings (### / ## / #)
  html = html.replace(/^###\s+(.+)$/gm, '<strong>$1</strong>');
  html = html.replace(/^##\s+(.+)$/gm, '<strong>$1</strong>');
  html = html.replace(/^#\s+(.+)$/gm, '<strong style="font-size:1.05em">$1</strong>');
  // Bold **text** then italic *text*
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code `code`
  html = html.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.08);padding:0.1em 0.3em;border-radius:3px;font-size:0.9em">$1</code>');
  // Bullet lists (- item or * item)
  html = html.replace(/^[\-\*]\s+(.+)$/gm, '&nbsp;&nbsp;• $1');
  // Numbered lists (1. item)
  html = html.replace(/^\d+\.\s+(.+)$/gm, (_, content) => '&nbsp;&nbsp;' + content);
  // Line breaks
  html = html.replace(/\n/g, '<br>');
  return html;
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
  // Also poll HUD cost/queries/uptime
  fetchHudStats();
  setInterval(fetchHudStats, 60000);
}

async function fetchHudStats() {
  try {
    const [usageRes, sysRes] = await Promise.all([
      fetch('/api/usage/daily?days=9999').catch(() => null),
      fetch('/api/system/metrics').catch(() => null),
    ]);
    if (usageRes && usageRes.ok) {
      const { daily } = await usageRes.json();
      let cost = 0, queries = 0;
      for (const d of daily) { cost += d.costUsd; queries += d.queries; }
      const costEl = document.getElementById('stat-cost');
      const queriesEl = document.getElementById('stat-queries');
      if (costEl) costEl.textContent = `$${cost.toFixed(2)}`;
      if (queriesEl) queriesEl.textContent = String(queries);
    }
    if (sysRes && sysRes.ok) {
      const metrics = await sysRes.json();
      const uptimeEl = document.getElementById('stat-uptime');
      if (uptimeEl) uptimeEl.textContent = metrics.uptimeFormatted || '--';
    }
  } catch { /* HUD stats are non-critical */ }
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


  const spriteSrc = agent.sprite || '';
  const mood = agent.mood || 'neutral';
  const moodEmoji = MOOD_EMOJI[mood] || '😐';
  const agentPhase = agent.phase || 'idle';
  const agentIsWorking = agentPhase !== 'idle' && agentPhase !== 'completed';
  // Skip stale reactions for idle/completed agents
  const lastEvent = (agent.lastEvent && !(agent.lastEvent.type === 'reaction' && !agentIsWorking)) ? agent.lastEvent : null;
  const lastIsThought = lastEvent ? isInnerThought(lastEvent.type) : false;
  const lastMsg = lastEvent ? (lastIsThought ? `（${lastEvent.message}）` : lastEvent.message) : '';

  // Sprite: use image if available, otherwise show avatar emoji as fallback
  const spriteContent = spriteSrc
    ? `<img src="${spriteSrc}" alt="${agent.name}" onerror="this.parentElement.querySelector('.sprite-fallback').style.display='flex';this.style.display='none'"><span class="sprite-fallback" style="display:none;font-size:2.5rem;width:100%;height:100%;align-items:center;justify-content:center">${agent.avatar || '🤖'}</span>`
    : `<span class="sprite-fallback" style="font-size:2.5rem;width:100%;height:100%;display:flex;align-items:center;justify-content:center">${agent.avatar || '🤖'}</span>`;

  sprite.innerHTML = `
    ${spriteContent}
    <span class="sprite-label">${agent.name}</span>
    <span class="sprite-mood">${moodEmoji}</span>
    <div class="sprite-bubble ${lastMsg ? 'visible' : ''}${lastIsThought ? ' mutter' : ''}">${lastMsg.length > 40 ? lastMsg.substring(0, 40) + '...' : lastMsg}</div>
  `;

  sprite.addEventListener('click', (e) => {
    if (spriteEditMode) { e.stopPropagation(); return; }
    openPortrait(agent);
  });
  scene.appendChild(sprite);
}

// --- One-shot sprite micro-animations ---
const PHASE_ANIMATION_CLASS = {
  task_received: 'sprite-jump',
  completed: 'sprite-celebrate',
  error: 'sprite-error',
};

function triggerPhaseAnimation(sprite, phase) {
  const animClass = PHASE_ANIMATION_CLASS[phase];
  if (!animClass) return;

  // Remove any existing one-shot animation classes
  sprite.classList.remove('sprite-jump', 'sprite-celebrate', 'sprite-error');

  // Force reflow so re-adding the same class restarts the animation
  void sprite.offsetWidth;

  sprite.classList.add(animClass);

  // Remove after animation completes
  const cleanup = () => {
    sprite.classList.remove(animClass);
    sprite.removeEventListener('animationend', cleanup);
  };
  sprite.addEventListener('animationend', cleanup);

  // Fallback removal in case animationend doesn't fire
  setTimeout(() => sprite.classList.remove(animClass), 1200);
}

// --- Update sprite status from event ---
function updateSpriteStatus(event) {
  const sprite = document.getElementById(`sprite-${event.agentId}`);
  if (!sprite) return;

  const phase = event.phase || 'idle';

  // One-shot micro-animations for phase transitions
  triggerPhaseAnimation(sprite, phase);

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

  // Update bubble — only personality events (mutter/reaction/reply), skip workflow/status_change
  if (event.message && (event.type === 'mutter' || event.type === 'reaction' || event.type === 'reply')) {
    const isThought = isInnerThought(event.type);
    const bubbleMsg = isThought ? `（${event.message}）` : event.message;
    showSpriteBubble(sprite, bubbleMsg, isThought);
  }
}

// --- Portrait emoji rendering ---
function renderPortraitEmoji(emojiSet, mood, phase) {
  if (emojiSet && typeof emojiSet === 'object') {
    const emojiKey = pickEmojiKey(emojiSet, mood, phase);
    if (emojiKey && emojiSet[emojiKey]) {
      return `<img src="${emojiSet[emojiKey]}" alt="emoji" class="emoji-entering">`;
    }
  }
  return `<span style="font-size:4rem">${MOOD_EMOJI[mood] || '😐'}</span>`;
}

// --- Portrait content ---
let portraitOpenAgentId = null;
let portraitLastEventId = null;

function updatePortraitContent(agentId) {
  const currentAgent = agentCards[agentId];
  if (!currentAgent) return;

  const phase = currentAgent.phase || 'idle';
  const mood = currentAgent.mood || 'neutral';

  // Status
  const statusInfo = PHASE_STATUS[phase] || PHASE_STATUS.idle;
  const statusEl = document.getElementById('dialogue-status');
  if (statusEl) statusEl.textContent = statusInfo.label;

  // Emoji
  const emojiEl = document.getElementById('dialogue-emoji');
  if (emojiEl) {
    const newHtml = renderPortraitEmoji(currentAgent.emoji, mood, phase);
    if (emojiEl.innerHTML !== newHtml) {
      emojiEl.innerHTML = newHtml;
    }
  }

  // Dialogue text — show latest personality event (skip workflow/status_change noise)
  const agentEvents = activityFeed.filter(e =>
    e.agentId === agentId && e.message &&
    (e.type === 'mutter' || e.type === 'reaction' || e.type === 'reply')
  );
  const latestEvent = agentEvents.length > 0 ? agentEvents[0] : null;
  const textEl = document.getElementById('dialogue-text');
  const ctxEl = document.getElementById('dialogue-task-context');

  if (textEl) {
    const eventId = latestEvent?.id || null;
    if (eventId !== portraitLastEventId) {
      portraitLastEventId = eventId;

      // Hide task context (now handled inline by formatDialogueEvent)
      if (ctxEl) ctxEl.style.display = 'none';

      if (latestEvent) {
        const fmt = formatDialogueEvent(latestEvent);
        textEl.className = `dialogue-text ${fmt.cssClass}`;
        typewriterEffect(textEl, fmt.text, fmt.speed, { markdown: !!fmt.markdown });
      } else {
        textEl.className = 'dialogue-text';
        textEl.textContent = defaultBubble();
      }
    }
  }
}

function buildBacklogHTML(events) {
  const TYPE_LABELS = { mutter: '獨白', reaction: '心聲', workflow: '系統', reply: '回覆' };
  const MSG_CLASS = { mutter: 'thought', reaction: 'thought', workflow: 'workflow-msg', reply: 'reply-msg' };
  return events.map(e => {
    const fmt = formatDialogueEvent(e, { truncate: false });
    const moodEmoji = MOOD_EMOJI[e.mood] || '';
    const typeLabel = TYPE_LABELS[e.type] || e.type;
    const msgClass = MSG_CLASS[e.type] || '';
    const isUserMsg = e.type === 'workflow' && e.phase === 'task_received' && e.metadata?.taskContent;
    return `<div class="backlog-entry entry-${e.type}">
      <div class="backlog-entry-header">
        <span class="backlog-icon">${fmt.icon}</span>
        ${moodEmoji ? `<span class="backlog-mood">${moodEmoji}</span>` : ''}
        <span class="backlog-type type-${e.type}">${typeLabel}</span>
        <span class="backlog-time">${relativeTime(e.timestamp)}</span>
      </div>
      <div class="backlog-msg ${isUserMsg ? 'user-msg' : msgClass}">${fmt.markdown ? renderSimpleMarkdown(fmt.text) : escapeHtml(fmt.text)}</div>
    </div>`;
  }).join('');
}

function updatePortraitIfOpen(agentId) {
  if (!portraitOpenAgentId || portraitOpenAgentId !== agentId) return;
  const overlay = document.getElementById('dialogue-overlay');
  if (!overlay || !overlay.classList.contains('active')) return;
  updatePortraitContent(agentId);
}

// --- Open portrait modal ---
function openPortrait(agent) {
  const overlay = document.getElementById('dialogue-overlay');
  if (!overlay) return;

  portraitOpenAgentId = agent.id;
  portraitLastEventId = null;  // Force fresh render
  clearRosterNotification(agent.id);
  const currentAgent = agentCards[agent.id] || agent;

  // Portrait image
  const portraitImg = document.getElementById('dialogue-portrait-img');
  if (currentAgent.portrait) {
    portraitImg.src = currentAgent.portrait;
    portraitImg.style.display = '';
  } else {
    portraitImg.style.display = 'none';
  }

  // Name plate
  document.getElementById('dialogue-name').textContent = currentAgent.name || agent.name;

  // Shared content: status, emoji, text, history
  updatePortraitContent(agent.id);

  overlay.classList.add('active');
}

// Close dialogue overlay
function closePortrait() {
  document.getElementById('dialogue-overlay').classList.remove('active');
  closeBacklog();
  portraitOpenAgentId = null;
  // Reset stats panel
  statsPanelOpen = false;
  const statsPanel = document.getElementById('dialogue-stats-panel');
  const statsBtn = document.getElementById('dialogue-stats-toggle');
  const boxInner = document.getElementById('dialogue-box-inner');
  const emoji = document.getElementById('dialogue-emoji');
  if (statsPanel) statsPanel.style.display = 'none';
  if (statsBtn) statsBtn.classList.remove('active');
  if (boxInner) boxInner.style.visibility = '';
  if (emoji) emoji.style.visibility = '';
}
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('dialogue-backdrop') || e.target.classList.contains('dialogue-close')) {
    closePortrait();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && portraitOpenAgentId) {
    closePortrait();
  }
});

// Backlog modal — open
document.addEventListener('click', (e) => {
  if (e.target.id === 'dialogue-history-toggle') {
    openBacklog();
  }
});

function openBacklog() {
  if (!portraitOpenAgentId) return;
  const overlay = document.getElementById('backlog-overlay');
  if (!overlay) return;

  const agent = agentCards[portraitOpenAgentId];
  const nameEl = document.getElementById('backlog-agent-name');
  if (nameEl) nameEl.textContent = agent?.name || portraitOpenAgentId;

  const scroll = document.getElementById('backlog-scroll');
  if (!scroll) return;

  // Filter meaningful dialogue events: user messages, thoughts, replies
  const agentEvents = activityFeed.filter(e => {
    if (e.agentId !== portraitOpenAgentId || !e.message) return false;
    if (e.type === 'reaction' || e.type === 'mutter' || e.type === 'reply') return true;
    if (e.type === 'workflow' && e.phase === 'task_received' && e.metadata?.taskContent) return true;
    return false;
  });
  // Sort oldest-first (dialogue chronological order)
  agentEvents.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  if (agentEvents.length === 0) {
    scroll.innerHTML = '<div class="backlog-empty">尚無歷史紀錄</div>';
  } else {
    scroll.innerHTML = buildBacklogHTML(agentEvents);
    // Auto-scroll to bottom (newest)
    scroll.scrollTop = scroll.scrollHeight;
  }

  overlay.classList.add('active');
}

function closeBacklog() {
  const overlay = document.getElementById('backlog-overlay');
  if (overlay) overlay.classList.remove('active');
}

// Backlog modal — close
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('backlog-backdrop') || e.target.id === 'backlog-close') {
    closeBacklog();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const overlay = document.getElementById('backlog-overlay');
    if (overlay && overlay.classList.contains('active')) {
      closeBacklog();
      e.stopPropagation();
    }
  }
});

// --- Dialogue Input: Send messages to agents from Web UI ---

async function sendMessageToAgent(agentId, text) {
  const sendBtn = document.getElementById('dialogue-send-btn');
  const input = document.getElementById('dialogue-input');
  const textEl = document.getElementById('dialogue-text');

  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.querySelector('.send-text').textContent = '傳送中...';
  }

  // Disable quick-reply buttons during send
  document.querySelectorAll('.quick-reply-btn').forEach(btn => btn.disabled = true);

  // Clear input immediately
  if (input) input.value = '';

  // Show user message in dialogue box right away
  if (textEl) {
    textEl.className = 'dialogue-text dialogue-user-msg';
    textEl.textContent = text;
  }

  try {
    const response = await fetch('/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, text })
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Failed to send message');
    }

    // Show thinking indicator — will be replaced when SSE reply arrives
    if (textEl) {
      textEl.className = 'dialogue-text dialogue-thinking';
      textEl.innerHTML = '思考中<span class="thinking-dot">.</span><span class="thinking-dot">.</span><span class="thinking-dot">.</span>';
    }

  } catch (error) {
    console.error('Send message error:', error);
    showLiveToast('傳送失敗：' + error.message, 'error');
    // Restore previous dialogue content
    if (portraitOpenAgentId) {
      portraitLastEventId = null;
      updatePortraitContent(portraitOpenAgentId);
    }
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.querySelector('.send-text').textContent = '送出';
    }
    document.querySelectorAll('.quick-reply-btn').forEach(btn => btn.disabled = false);
  }
}

// --- ADR-033: Interactive Prompts (Galgame Choices) ---

function showPermissionPrompt(event) {
  // Auto-open portrait if not already viewing this agent
  if (portraitOpenAgentId !== event.agentId) {
    const agent = agentCards[event.agentId];
    if (agent) openPortrait(agent);
  }

  const container = document.querySelector('.dialogue-quick-replies');
  if (!container) return;

  container.innerHTML = `
    <div class="interaction-prompt">
      <div class="prompt-label">🔐 工具授權請求</div>
      <div class="prompt-detail">${escapeHtml(event.toolName || '')}${event.decisionReason ? ' — ' + escapeHtml(event.decisionReason) : ''}</div>
      <div class="prompt-choices">
        <button class="choice-btn choice-allow" onclick="resolvePermission('${event.requestId}', 'allow')">允許</button>
        <button class="choice-btn choice-always" onclick="resolvePermission('${event.requestId}', 'always')">永遠允許</button>
        <button class="choice-btn choice-deny" onclick="resolvePermission('${event.requestId}', 'deny')">拒絕</button>
      </div>
    </div>
  `;
}

function showQuestionPrompt(event) {
  // Auto-open portrait if not already viewing this agent
  if (portraitOpenAgentId !== event.agentId) {
    const agent = agentCards[event.agentId];
    if (agent) openPortrait(agent);
  }

  const container = document.querySelector('.dialogue-quick-replies');
  if (!container) return;

  const optionButtons = (event.options || []).map((opt, i) =>
    `<button class="choice-btn choice-option" onclick="resolveQuestion('${event.requestId}', '${escapeHtml(opt.label)}')" title="${escapeHtml(opt.description)}">${escapeHtml(opt.label)}</button>`
  ).join('');

  container.innerHTML = `
    <div class="interaction-prompt">
      <div class="prompt-label">❓ ${escapeHtml(event.header || '選擇')}</div>
      <div class="prompt-detail">${escapeHtml(event.question || '')}</div>
      <div class="prompt-choices">
        ${optionButtons}
        <button class="choice-btn choice-deny" onclick="resolveQuestion('${event.requestId}', null)">取消</button>
      </div>
    </div>
  `;
}

async function resolvePermission(requestId, decision) {
  const container = document.querySelector('.interaction-prompt');
  if (container) {
    container.querySelectorAll('.choice-btn').forEach(btn => btn.disabled = true);
  }

  try {
    const res = await fetch('/api/messages/resolve-permission', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, decision })
    });
    if (!res.ok) throw new Error('Failed');

    const label = decision === 'allow' ? '✅ 已允許' : decision === 'always' ? '✅ 永遠允許' : '❌ 已拒絕';
    if (container) container.innerHTML = `<div class="prompt-resolved">${label}</div>`;
    setTimeout(restoreQuickReplies, 2000);
  } catch (err) {
    console.error('resolvePermission error:', err);
    showLiveToast('操作失敗', 'error');
    if (container) container.querySelectorAll('.choice-btn').forEach(btn => btn.disabled = false);
  }
}

async function resolveQuestion(requestId, answer) {
  const container = document.querySelector('.interaction-prompt');
  if (container) {
    container.querySelectorAll('.choice-btn').forEach(btn => btn.disabled = true);
  }

  try {
    const res = await fetch('/api/messages/resolve-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId, answer })
    });
    if (!res.ok) throw new Error('Failed');

    const label = answer ? `✅ ${escapeHtml(answer)}` : '❌ 已取消';
    if (container) container.innerHTML = `<div class="prompt-resolved">${label}</div>`;
    setTimeout(restoreQuickReplies, 2000);
  } catch (err) {
    console.error('resolveQuestion error:', err);
    showLiveToast('操作失敗', 'error');
    if (container) container.querySelectorAll('.choice-btn').forEach(btn => btn.disabled = false);
  }
}

function restoreQuickReplies() {
  const container = document.querySelector('.dialogue-quick-replies');
  if (!container) return;
  container.innerHTML = `
    <button class="quick-reply-btn" data-text="最近怎麼樣？">最近怎麼樣？</button>
    <button class="quick-reply-btn" data-text="有什麼需要幫忙的嗎？">有什麼需要幫忙的嗎？</button>
    <button class="quick-reply-btn" data-text="聊聊天吧">聊聊天吧</button>
  `;
  // Re-attach handlers
  container.querySelectorAll('.quick-reply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (portraitOpenAgentId) sendMessageToAgent(portraitOpenAgentId, btn.dataset.text);
    });
  });
}

// Toast notification for Live page
function showLiveToast(message, type = 'info') {
  const existing = document.querySelector('.live-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `live-toast live-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function initDialogueInput() {
  // Quick reply buttons
  document.querySelectorAll('.quick-reply-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!portraitOpenAgentId) return;
      sendMessageToAgent(portraitOpenAgentId, btn.dataset.text);
    });
  });

  // Send button
  const sendBtn = document.getElementById('dialogue-send-btn');
  const input = document.getElementById('dialogue-input');

  if (sendBtn && input) {
    sendBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (text && portraitOpenAgentId) {
        sendMessageToAgent(portraitOpenAgentId, text);
      }
    });

    // Enter to send, Shift+Enter for newline
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        const text = input.value.trim();
        if (text && portraitOpenAgentId) {
          sendMessageToAgent(portraitOpenAgentId, text);
        }
      }
    });
  }
}

// --- Context Menu ---
let contextMenuEl = null;

function createContextMenu() {
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.id = 'ctx-menu';
  menu.innerHTML = `
    <button class="ctx-item" data-action="chat">💬 對話</button>
    <button class="ctx-item" data-action="send">✉️ 傳送訊息</button>
    <button class="ctx-item" data-action="history">📜 歷史紀錄</button>
    <div class="ctx-divider"></div>
    <button class="ctx-item" data-action="filter">🔍 篩選動態</button>
  `;
  document.body.appendChild(menu);
  contextMenuEl = menu;
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('.ctx-item');
    if (!item) return;
    const action = item.dataset.action;
    const agentId = menu.dataset.agentId;
    const agent = agentCards[agentId];
    if (!agent) { hideContextMenu(); return; }
    switch (action) {
      case 'chat': openPortrait(agent); break;
      case 'send':
        openPortrait(agent);
        setTimeout(() => { const input = document.getElementById('dialogue-input'); if (input) input.focus(); }, 100);
        break;
      case 'history': openPortrait(agent); setTimeout(() => openBacklog(), 100); break;
      case 'filter':
        const filterBtn = document.querySelector(`.filter-btn[data-filter="agent:${agentId}"]`);
        if (filterBtn) filterBtn.click();
        break;
    }
    hideContextMenu();
  });
}

function showContextMenu(e, agentId) {
  e.preventDefault();
  if (!contextMenuEl) createContextMenu();
  contextMenuEl.dataset.agentId = agentId;
  const x = Math.min(e.clientX, window.innerWidth - 180);
  const y = Math.min(e.clientY, window.innerHeight - 200);
  contextMenuEl.style.left = x + 'px';
  contextMenuEl.style.top = y + 'px';
  contextMenuEl.classList.add('visible');
}

function hideContextMenu() {
  if (contextMenuEl) contextMenuEl.classList.remove('visible');
}

document.addEventListener('click', (e) => {
  if (contextMenuEl && !contextMenuEl.contains(e.target)) hideContextMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideContextMenu(); });
document.addEventListener('contextmenu', (e) => {
  const sprite = e.target.closest('.agent-sprite');
  if (sprite) { showContextMenu(e, sprite.id.replace('sprite-', '')); return; }
  const card = e.target.closest('.roster-card');
  if (card) { showContextMenu(e, card.id.replace('roster-', '')); return; }
});

// --- Day/Night Sky Background ---
const SKY_BACKGROUNDS = {
  dawn:  '/static/images/bg-dawn.png',
  day:   '/static/images/bg-day.png',
  dusk:  '/static/images/bg-dusk.png',
  night: '/static/images/bg-night.png',
};

let currentTimePeriod = null;

function getTimePeriod() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'dusk';
  return 'night';
}

function updateSkyBackground() {
  const period = getTimePeriod();
  if (period === currentTimePeriod) return;
  currentTimePeriod = period;

  const skyLayer = document.getElementById('sky-layer');
  if (!skyLayer) return;

  skyLayer.style.backgroundImage = `url('${SKY_BACKGROUNDS[period]}')`;
  console.log(`[Sky] switched to ${period}`);
}

// ============================================
// GAME MENU
// ============================================

let gameMenuOpen = false;
let gameMenuAuthed = null; // null = unchecked, true/false
let gameMenuActiveDays = 1;

function openGameMenu() {
  const overlay = document.getElementById('game-menu-overlay');
  if (!overlay) return;
  overlay.classList.add('active');
  gameMenuOpen = true;

  if (gameMenuAuthed === null) {
    checkGameMenuAuth();
  } else if (gameMenuAuthed) {
    loadMenuUsageData(gameMenuActiveDays);
  }
}

function closeGameMenu() {
  const overlay = document.getElementById('game-menu-overlay');
  if (!overlay) return;
  overlay.classList.remove('active');
  gameMenuOpen = false;
}

async function checkGameMenuAuth() {
  try {
    const res = await fetch('/api/system/health');
    if (res.status === 401) {
      gameMenuAuthed = false;
      document.getElementById('game-menu-auth-gate').style.display = '';
      document.querySelectorAll('.game-menu-page').forEach(p => p.classList.remove('active'));
    } else {
      gameMenuAuthed = true;
      document.getElementById('game-menu-auth-gate').style.display = 'none';
      document.querySelector('.game-menu-page')?.classList.add('active');
      loadMenuUsageData(gameMenuActiveDays);
    }
  } catch {
    gameMenuAuthed = false;
    document.getElementById('game-menu-auth-gate').style.display = '';
    document.querySelectorAll('.game-menu-page').forEach(p => p.classList.remove('active'));
  }
}

function switchMenuTab(tab) {
  document.querySelectorAll('.game-menu-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === tab)
  );
  document.querySelectorAll('.game-menu-page').forEach(p =>
    p.classList.toggle('active', p.id === `menu-page-${tab}`)
  );
  // Load data for the active tab
  if (gameMenuAuthed) {
    if (tab === 'usage') loadMenuUsageData(gameMenuActiveDays);
    else if (tab === 'sessions') loadMenuSessions();
    else if (tab === 'system') loadMenuSystem();
    else if (tab === 'agents') loadMenuAgents();
  }
}

// --- Usage tab ---

function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

async function loadMenuUsageData(days) {
  gameMenuActiveDays = days;
  try {
    const [dailyRes, agentsRes] = await Promise.all([
      fetch(`/api/usage/daily?days=${days}`),
      fetch(`/api/usage/agents?days=${days}`),
    ]);
    const { daily } = await dailyRes.json();
    const { agents: agentStats } = await agentsRes.json();

    // Summary cards from daily totals
    let totalCost = 0, totalQueries = 0, totalIn = 0, totalOut = 0;
    for (const d of daily) {
      totalCost += d.costUsd;
      totalQueries += d.queries;
      totalIn += d.inputTokens;
      totalOut += d.outputTokens;
    }

    document.getElementById('menu-cost').textContent = `$${totalCost.toFixed(2)}`;
    document.getElementById('menu-queries').textContent = totalQueries.toLocaleString();
    document.getElementById('menu-input-tokens').textContent = formatTokenCount(totalIn);
    document.getElementById('menu-output-tokens').textContent = formatTokenCount(totalOut);

    drawMenuUsageChart(daily);
    renderMenuAgentTable(agentStats);
  } catch (err) {
    console.error('[GameMenu] Failed to load usage data:', err);
  }
}

function drawMenuUsageChart(daily) {
  const canvas = document.getElementById('menu-usage-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const rect = canvas.parentElement.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;
  ctx.clearRect(0, 0, w, h);

  if (daily.length === 0) {
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暫無數據', w / 2, h / 2);
    return;
  }

  const pad = { top: 20, right: 15, bottom: 28, left: 45 };
  const cw = w - pad.left - pad.right;
  const ch = h - pad.top - pad.bottom;
  const maxCost = Math.max(...daily.map(d => d.costUsd), 0.01);
  const barGap = 4;
  const barW = Math.max((cw / daily.length) - barGap, 6);

  daily.forEach((d, i) => {
    const barH = (d.costUsd / maxCost) * ch;
    const x = pad.left + i * (cw / daily.length) + barGap / 2;
    const y = pad.top + ch - barH;

    const grad = ctx.createLinearGradient(x, y + barH, x, y);
    grad.addColorStop(0, 'rgba(200,140,170,0.5)');
    grad.addColorStop(1, 'rgba(220,170,195,0.9)');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);

    // Date label
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.date.substring(5), x + barW / 2, pad.top + ch + 15);
  });

  // Y-axis
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('$' + maxCost.toFixed(2), pad.left - 5, pad.top + 10);
  ctx.fillText('$0', pad.left - 5, pad.top + ch + 4);

  // Grid line
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + ch);
  ctx.lineTo(pad.left + cw, pad.top + ch);
  ctx.stroke();
}

function renderMenuAgentTable(agentStats) {
  const container = document.getElementById('menu-usage-agents');
  if (!container) return;

  if (!agentStats || agentStats.length === 0) {
    container.innerHTML = '<div class="menu-loading">暫無數據</div>';
    return;
  }

  // Sort by cost descending
  const sorted = [...agentStats].sort((a, b) => b.totalCostUsd - a.totalCostUsd);

  container.innerHTML = `
    <table class="agent-usage-table">
      <thead><tr>
        <th>Agent</th><th>花費</th><th>查詢</th><th>IN</th><th>OUT</th>
      </tr></thead>
      <tbody>${sorted.map(a => {
        const color = agentCards[a.agentId]?.color || '#6B7280';
        return `<tr>
          <td><span class="agent-usage-dot" style="background:${color}"></span>${escapeHtml(a.agentName)}</td>
          <td>$${a.totalCostUsd.toFixed(3)}</td>
          <td>${a.totalQueries}</td>
          <td>${formatTokenCount(a.totalInputTokens)}</td>
          <td>${formatTokenCount(a.totalOutputTokens)}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
}

// --- Sessions tab ---

async function loadMenuSessions() {
  const container = document.getElementById('menu-sessions-list');
  if (!container) return;
  try {
    const res = await fetch('/api/sessions');
    const { sessions } = await res.json();
    if (!sessions || sessions.length === 0) {
      container.innerHTML = '<div class="menu-loading">目前沒有任何 session</div>';
      return;
    }
    container.innerHTML = sessions.map(s => {
      const color = agentCards[s.agentId]?.color || '#6B7280';
      const dotClass = s.state === 'processing' ? 'processing' : 'idle';
      const ago = relativeTime(s.lastActiveAt);
      return `<div class="session-item" data-sid="${s.sessionId}">
        <div class="session-info">
          <span class="session-dot ${dotClass}"></span>
          <span class="session-agent" style="color:${color}">${escapeHtml(s.agentName)}</span>
          <span class="session-user">${escapeHtml(s.userId?.substring(0, 12) || '--')}</span>
        </div>
        <div class="session-meta">
          <span>${s.messageCount} 訊息</span>
          <span>${ago}</span>
          ${!s.isExpired ? `<button class="session-close-btn" onclick="closeMenuSession('${s.sessionId}')">✕</button>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('[GameMenu] Failed to load sessions:', err);
    container.innerHTML = '<div class="menu-loading">載入失敗</div>';
  }
}

async function closeMenuSession(sessionId) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    if (res.ok) loadMenuSessions();
  } catch (err) {
    console.error('[GameMenu] Failed to close session:', err);
  }
}

async function cleanupMenuSessions() {
  const btn = document.getElementById('menu-sessions-cleanup');
  if (btn) { btn.disabled = true; btn.textContent = '清理中...'; }
  try {
    await fetch('/api/sessions/cleanup', { method: 'POST' });
    await loadMenuSessions();
  } catch (err) {
    console.error('[GameMenu] Cleanup failed:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🧹 清理過期'; }
  }
}

// --- System tab ---

async function loadMenuSystem() {
  try {
    const [metricsRes, botsRes] = await Promise.all([
      fetch('/api/system/metrics'),
      fetch('/api/system/bots'),
    ]);
    const metrics = await metricsRes.json();
    const { bots } = await botsRes.json();

    // Uptime
    const uptimeEl = document.getElementById('menu-sys-uptime');
    if (uptimeEl) uptimeEl.textContent = metrics.uptimeFormatted || '--';

    // Memory
    const memEl = document.getElementById('menu-sys-memory');
    if (memEl) memEl.textContent = metrics.memory?.heapUsedFormatted || '--';

    // Sessions
    const sessEl = document.getElementById('menu-sys-sessions');
    if (sessEl) sessEl.textContent = String(metrics.sessions?.active ?? 0);

    // Heap bar
    const heapText = document.getElementById('menu-sys-heap-text');
    const heapBar = document.getElementById('menu-sys-heap-bar');
    if (heapText && metrics.memory) {
      heapText.textContent = `${metrics.memory.heapUsedFormatted} / ${metrics.memory.heapTotalFormatted}`;
    }
    if (heapBar && metrics.memory) {
      const pct = Math.min((metrics.memory.heapUsed / metrics.memory.heapTotal) * 100, 100);
      heapBar.style.width = pct + '%';
    }

    // Bots list
    const botsContainer = document.getElementById('menu-sys-bots');
    if (botsContainer && bots) {
      if (bots.length === 0) {
        botsContainer.innerHTML = '<div class="menu-loading">沒有 bot</div>';
      } else {
        botsContainer.innerHTML = bots.map(b => {
          const statusClass = b.status === 'running' ? 'running' : (b.status === 'error' ? 'error' : 'stopped');
          const action = b.status === 'running' ? 'stop' : 'start';
          const actionLabel = b.status === 'running' ? '停止' : '啟動';
          const color = agentCards[b.agentId]?.color || '#6B7280';
          return `<div class="bot-item">
            <div class="bot-info">
              <span class="bot-status-dot ${statusClass}"></span>
              <span class="bot-name" style="color:${color}">${escapeHtml(b.agentName || b.agentId)}</span>
            </div>
            <button class="bot-toggle-btn" onclick="toggleBot('${b.agentId}', '${action}')">${actionLabel}</button>
          </div>`;
        }).join('');
      }
    }
  } catch (err) {
    console.error('[GameMenu] Failed to load system:', err);
  }
}

async function toggleBot(agentId, action) {
  try {
    await fetch(`/api/agents/${agentId}/bot/${action}`, { method: 'POST' });
    await loadMenuSystem();
  } catch (err) {
    console.error(`[GameMenu] Failed to ${action} bot:`, err);
  }
}

// --- Agents tab ---

async function loadMenuAgents() {
  const container = document.getElementById('menu-agents-list');
  if (!container) return;
  try {
    const res = await fetch('/api/agents');
    const { agents } = await res.json();
    if (!agents || agents.length === 0) {
      container.innerHTML = '<div class="menu-loading">沒有 agent</div>';
      return;
    }
    container.innerHTML = agents.map(a => {
      const card = agentCards[a.id] || {};
      const avatar = card.avatar || '🤖';
      const color = card.color || '#6B7280';
      const botBadges = (a.botStatus || []).map(b =>
        `<span class="bot-status-dot ${b.status}" style="margin-left:0.3rem" title="${b.platform}: ${b.status}"></span>`
      ).join('');
      return `<div class="agent-item" onclick="openPortrait(agentCards['${a.id}'] || {id:'${a.id}',name:'${escapeHtml(a.name)}'})">
        <div class="agent-item-info">
          <span class="agent-item-avatar">${avatar}</span>
          <div>
            <div class="agent-item-name" style="color:${color}">${escapeHtml(a.name)}${botBadges}</div>
            <div style="font-size:0.7rem;color:var(--text-muted)">${escapeHtml(a.description?.substring(0, 60) || '')}</div>
          </div>
        </div>
        <div class="agent-item-actions">
          <span class="agent-item-model">${a.model || '--'}</span>
          <button class="menu-action-btn" onclick="event.stopPropagation(); reloadAgent('${a.id}')">🔄</button>
        </div>
      </div>`;
    }).join('');
  } catch (err) {
    console.error('[GameMenu] Failed to load agents:', err);
    container.innerHTML = '<div class="menu-loading">載入失敗</div>';
  }
}

async function reloadAgent(agentId) {
  try {
    await fetch(`/api/agents/${agentId}/reload`, { method: 'POST' });
    showLiveToast(`${agentId} 重載成功`);
    await loadMenuAgents();
  } catch (err) {
    showLiveToast('重載失敗', 'error');
  }
}

// --- Roster Notification Badges ---

const rosterNotifications = new Set(); // agentIds with unread personality events

function addRosterNotification(agentId) {
  // Don't notify if portrait is already open for this agent
  if (portraitOpenAgentId === agentId) return;
  if (rosterNotifications.has(agentId)) return;
  rosterNotifications.add(agentId);

  const card = document.getElementById(`roster-${agentId}`);
  if (card && !card.querySelector('.roster-notify-dot')) {
    const dot = document.createElement('span');
    dot.className = 'roster-notify-dot';
    card.appendChild(dot);
  }
}

function clearRosterNotification(agentId) {
  rosterNotifications.delete(agentId);
  const card = document.getElementById(`roster-${agentId}`);
  const dot = card?.querySelector('.roster-notify-dot');
  if (dot) dot.remove();
}

// --- Agent Stats Panel in Portrait ---

let statsPanelOpen = false;

function toggleStatsPanel() {
  const panel = document.getElementById('dialogue-stats-panel');
  const btn = document.getElementById('dialogue-stats-toggle');
  const boxInner = document.getElementById('dialogue-box-inner');
  const emoji = document.getElementById('dialogue-emoji');
  if (!panel || !btn) return;

  statsPanelOpen = !statsPanelOpen;
  panel.style.display = statsPanelOpen ? '' : 'none';
  if (boxInner) boxInner.style.visibility = statsPanelOpen ? 'hidden' : '';
  if (emoji) emoji.style.visibility = statsPanelOpen ? 'hidden' : '';
  btn.classList.toggle('active', statsPanelOpen);

  if (statsPanelOpen && portraitOpenAgentId) {
    loadAgentStatsPanel(portraitOpenAgentId);
  }
}

async function loadAgentStatsPanel(agentId) {
  try {
    const [usageRes, agentRes] = await Promise.all([
      fetch(`/api/usage/daily?days=1&agent=${agentId}`).catch(() => null),
      fetch(`/api/agents/${agentId}`).catch(() => null),
    ]);

    if (usageRes && usageRes.ok) {
      const { daily } = await usageRes.json();
      let cost = 0, queries = 0, inT = 0, outT = 0;
      for (const d of daily) { cost += d.costUsd; queries += d.queries; inT += d.inputTokens; outT += d.outputTokens; }
      document.getElementById('stats-cost').textContent = `$${cost.toFixed(3)}`;
      document.getElementById('stats-queries').textContent = String(queries);
      document.getElementById('stats-in').textContent = formatTokenCount(inT);
      document.getElementById('stats-out').textContent = formatTokenCount(outT);
    }

    if (agentRes && agentRes.ok) {
      const data = await agentRes.json();
      document.getElementById('stats-model').textContent = data.model || '--';
    }

    // Bot status
    const botRes = await fetch(`/api/agents/${agentId}/bot/status`).catch(() => null);
    if (botRes && botRes.ok) {
      const { status } = await botRes.json();
      const label = status?.[0]?.status || 'no bot';
      document.getElementById('stats-bot-status').textContent = label;
    }
  } catch { /* non-critical */ }
}

// --- Game Menu Event Listeners ---

function initGameMenu() {
  document.getElementById('header-menu-btn')?.addEventListener('click', openGameMenu);
  document.getElementById('game-menu-close')?.addEventListener('click', closeGameMenu);
  document.querySelector('.game-menu-backdrop')?.addEventListener('click', closeGameMenu);

  // Tab switching
  document.querySelectorAll('.game-menu-tab').forEach(tab => {
    tab.addEventListener('click', () => switchMenuTab(tab.dataset.tab));
  });

  // Period buttons
  document.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadMenuUsageData(parseInt(btn.dataset.days));
    });
  });

  // Stats panel toggle in portrait
  document.getElementById('dialogue-stats-toggle')?.addEventListener('click', toggleStatsPanel);

  // Clickable HUD stats → open menu tab
  document.querySelectorAll('.mini-stat.clickable').forEach(stat => {
    stat.addEventListener('click', () => {
      const tab = stat.dataset.menuTab;
      if (tab) {
        openGameMenu();
        switchMenuTab(tab);
      }
    });
  });

  // Sessions cleanup button
  document.getElementById('menu-sessions-cleanup')?.addEventListener('click', cleanupMenuSessions);

  // Sidebar toggle
  document.getElementById('sidebar-toggle-btn')?.addEventListener('click', () => {
    const sidebar = document.getElementById('office-sidebar');
    const btn = document.getElementById('sidebar-toggle-btn');
    if (!sidebar || !btn) return;
    const isCollapsed = !sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed', isCollapsed);
    btn.classList.toggle('sidebar-open', !isCollapsed);
    btn.textContent = isCollapsed ? '◀' : '▶';
  });

  // ESC key — capture phase so game menu takes priority over other overlays
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && gameMenuOpen) {
      closeGameMenu();
      e.stopImmediatePropagation();
    }
  }, true);
}


// ============================
// SPRITE EDIT MODE — Drag to reposition
// ============================
let spriteEditMode = false;
let dragState = null; // { sprite, startX, startY, origLeft, origTop }

function getCustomPositions() {
  try {
    const raw = localStorage.getItem(CUSTOM_POS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveCustomPosition(agentId, leftPct, topPct) {
  const all = getCustomPositions();
  all[agentId] = { left: leftPct, top: topPct };
  try { localStorage.setItem(CUSTOM_POS_KEY, JSON.stringify(all)); } catch {}
}

// Snapshot of positions/bg before editing, for cancel/revert
let editSnapshot = null;

function enterEditMode() {
  const scene = document.getElementById('office-scene');
  const btn = document.getElementById('scene-edit-btn');
  const toolbar = document.getElementById('edit-toolbar');
  if (!scene || spriteEditMode) return;

  // Snapshot current state for cancel
  editSnapshot = {
    positions: JSON.parse(JSON.stringify(getCustomPositions())),
    bg: getOfficeBg()
  };

  spriteEditMode = true;
  scene.classList.add('edit-mode');
  if (btn) btn.classList.add('active');
  if (toolbar) toolbar.classList.remove('hidden');
}

function exitEditMode(save) {
  const scene = document.getElementById('office-scene');
  const btn = document.getElementById('scene-edit-btn');
  const toolbar = document.getElementById('edit-toolbar');
  const picker = document.getElementById('edit-bg-picker');

  if (save) {
    // Write all pending positions to localStorage
    const sprites = document.querySelectorAll('.agent-sprite');
    const sceneRect = scene.getBoundingClientRect();
    sprites.forEach(sprite => {
      const agentId = sprite.id.replace('sprite-', '');
      const leftPct = ((sprite.offsetLeft / sceneRect.width) * 100).toFixed(1) + '%';
      const topPct = ((sprite.offsetTop / sceneRect.height) * 100).toFixed(1) + '%';
      saveCustomPosition(agentId, leftPct, topPct);
    });
    // bg is already saved by setOfficeBg
  } else {
    // Cancel — revert positions and bg
    if (editSnapshot) {
      localStorage.setItem(CUSTOM_POS_KEY, JSON.stringify(editSnapshot.positions));
      setOfficeBg(editSnapshot.bg);
      // Restore sprite positions from snapshot
      const sprites = document.querySelectorAll('.agent-sprite');
      sprites.forEach(sprite => {
        const agentId = sprite.id.replace('sprite-', '');
        const pos = editSnapshot.positions[agentId];
        if (pos) {
          sprite.style.left = pos.left;
          sprite.style.top = pos.top;
        }
      });
    }
  }

  spriteEditMode = false;
  editSnapshot = null;
  scene.classList.remove('edit-mode');
  if (btn) btn.classList.remove('active');
  if (toolbar) toolbar.classList.add('hidden');
  if (picker) picker.classList.add('hidden');
}

function initSpriteEditMode() {
  const scene = document.getElementById('office-scene');
  const btn = document.getElementById('scene-edit-btn');
  const saveBtn = document.getElementById('edit-save');
  const cancelBtn = document.getElementById('edit-cancel');
  const bgBtn = document.getElementById('edit-bg-btn');
  const bgPicker = document.getElementById('edit-bg-picker');
  if (!scene || !btn) return;

  btn.addEventListener('click', () => {
    if (spriteEditMode) {
      exitEditMode(true); // clicking 🔧 again = save
    } else {
      enterEditMode();
    }
  });

  if (saveBtn) saveBtn.addEventListener('click', () => exitEditMode(true));
  if (cancelBtn) cancelBtn.addEventListener('click', () => exitEditMode(false));

  // BG picker toggle
  if (bgBtn && bgPicker) {
    bgBtn.addEventListener('click', () => bgPicker.classList.toggle('hidden'));
    // Close picker on outside click
    document.addEventListener('click', (e) => {
      if (!bgPicker.contains(e.target) && e.target !== bgBtn) {
        bgPicker.classList.add('hidden');
      }
    });
  }

  // BG picker items
  const bgItems = document.querySelectorAll('#edit-bg-picker .bg-picker-item');
  bgItems.forEach(item => {
    if (item.dataset.bg === getOfficeBg()) item.classList.add('active');
    item.addEventListener('click', () => {
      setOfficeBg(item.dataset.bg);
      bgItems.forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    });
  });

  // --- Drag handlers (pointer events for mouse + touch) ---
  scene.addEventListener('pointerdown', (e) => {
    if (!spriteEditMode) return;
    const sprite = e.target.closest('.agent-sprite');
    if (!sprite) return;

    e.preventDefault();
    sprite.setPointerCapture(e.pointerId);
    sprite.classList.add('dragging');

    const rect = scene.getBoundingClientRect();
    dragState = {
      sprite,
      pointerId: e.pointerId,
      offsetX: e.clientX - sprite.getBoundingClientRect().left,
      offsetY: e.clientY - sprite.getBoundingClientRect().top,
      sceneRect: rect,
    };
  });

  scene.addEventListener('pointermove', (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    e.preventDefault();

    const { sprite, offsetX, offsetY, sceneRect } = dragState;
    const x = e.clientX - sceneRect.left - offsetX;
    const y = e.clientY - sceneRect.top - offsetY;

    const maxX = sceneRect.width - sprite.offsetWidth;
    const maxY = sceneRect.height - sprite.offsetHeight;
    const clampedX = Math.max(0, Math.min(x, maxX));
    const clampedY = Math.max(0, Math.min(y, maxY));

    sprite.style.left = ((clampedX / sceneRect.width) * 100).toFixed(1) + '%';
    sprite.style.top = ((clampedY / sceneRect.height) * 100).toFixed(1) + '%';
  });

  scene.addEventListener('pointerup', (e) => {
    if (!dragState || e.pointerId !== dragState.pointerId) return;
    dragState.sprite.classList.remove('dragging');
    dragState.sprite.releasePointerCapture(e.pointerId);
    dragState = null;
    // Don't save to localStorage here — wait for save button
  });

  scene.addEventListener('pointercancel', () => {
    if (dragState) {
      dragState.sprite.classList.remove('dragging');
      dragState = null;
    }
  });
}

// --- Title Screen ---
function spawnParticles() {
  const container = document.getElementById('title-particles');
  if (!container) return;
  for (let i = 0; i < 25; i++) {
    const p = document.createElement('div');
    p.className = 'title-particle';
    p.style.left = Math.random() * 100 + '%';
    p.style.animationDuration = (4 + Math.random() * 6) + 's';
    p.style.animationDelay = Math.random() * 5 + 's';
    p.style.width = p.style.height = (2 + Math.random() * 4) + 'px';
    container.appendChild(p);
  }
}

function initTitleScreen() {
  const screen = document.getElementById('title-screen');
  const startBtn = document.getElementById('title-start');
  if (!screen) return;

  spawnParticles();

  const dismiss = () => {
    screen.classList.add('hidden');
    document.removeEventListener('keydown', dismissKey);
    setTimeout(() => screen.remove(), 1100);
  };
  const dismissKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') dismiss();
  };

  if (startBtn) startBtn.addEventListener('click', dismiss);
  document.addEventListener('keydown', dismissKey);
}

// --- Office Background Switcher ---
const BG_KEY = 'claudecab-office-bg';
const OFFICE_BACKGROUNDS = {
  default: '/static/images/office-background.png',
  cny: '/static/images/office-background-cny.png'
};

function getOfficeBg() {
  return localStorage.getItem(BG_KEY) || 'default';
}

function setOfficeBg(key) {
  localStorage.setItem(BG_KEY, key);
  const bgImg = document.querySelector('.office-bg');
  if (bgImg && OFFICE_BACKGROUNDS[key]) {
    bgImg.src = OFFICE_BACKGROUNDS[key];
  }
}

// --- Start ---
document.addEventListener('DOMContentLoaded', () => {
  initTitleScreen();
  init();
  initGameMenu();
  initSpriteEditMode();
  setOfficeBg(getOfficeBg()); // apply saved bg on load
});
