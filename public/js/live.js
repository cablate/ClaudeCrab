/**
 * ClaudeCab Live — Real-time agent activity display (v2.0)
 */

// --- State ---
const agentCards = {};
const activityFeed = [];
const MAX_FEED_ITEMS = 50;
let activeFilter = 'all'; // 'all' | 'workflow' | 'personality' | 'agent:{id}'

// Mood emoji mapping
const MOOD_EMOJI = {
  neutral: '',
  excited: '',
  annoyed: '',
  tired: '',
  focused: '',
  bored: '',
};

// Phase status mapping
const PHASE_STATUS = {
  task_received: { label: 'new task', class: 'status-working' },
  working: { label: 'working', class: 'status-working' },
  tool_use: { label: 'using tool', class: 'status-working' },
  completed: { label: 'done', class: 'status-idle' },
  error: { label: 'error', class: 'status-error' },
  idle: { label: 'idle', class: 'status-idle' },
};

// Workflow phase icons (for structured log entries)
const WORKFLOW_ICONS = {
  task_received: '📩',
  working: '⚡',
  tool_use: '🔧',
  completed: '✅',
  error: '❌',
  idle: '💤',
};

// --- Initialize ---
async function init() {
  await loadAgentStates();
  connectSSE();
  startRelativeTimeUpdater();
  initFilters();
}

// --- Load initial agent states ---
async function loadAgentStates() {
  try {
    const res = await fetch('/api/activity/agents');
    const { agents } = await res.json();
    const container = document.getElementById('agent-cards');
    container.innerHTML = '';
    for (const agent of agents) {
      const card = createAgentCard(agent);
      container.appendChild(card);
      agentCards[agent.id] = agent;
    }
  } catch (err) {
    console.error('Failed to load agent states:', err);
  }
}

// --- Load recent events ---
async function loadRecentEvents() {
  try {
    const res = await fetch('/api/activity/events');
    const { events } = await res.json();
    for (const event of events) {
      if (event.type !== 'status_change') {
        addToFeed(event, false);
      }
    }
  } catch (err) {
    console.error('Failed to load recent events:', err);
  }
}

// --- SSE Connection ---
function connectSSE() {
  const source = new EventSource('/api/activity/stream');
  let isInitialBatch = true;

  // After 2s, treat all subsequent events as live
  setTimeout(() => { isInitialBatch = false; }, 2000);

  source.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      if (isInitialBatch) {
        // Initial batch: only add to feed, don't update agent cards with stale data
        if (event.type !== 'status_change') {
          addToFeed(event, false);
        }
      } else {
        handleActivityEvent(event);
      }
    } catch (err) {
      console.error('Failed to parse SSE event:', err);
    }
  };

  source.onerror = () => {
    console.warn('SSE connection lost, reconnecting in 3s...');
    source.close();
    setTimeout(connectSSE, 3000);
  };

  // Update connection status
  const dot = document.getElementById('connection-dot');
  if (dot) dot.classList.add('connected');
  source.addEventListener('open', () => {
    if (dot) dot.classList.add('connected');
  });
}

// --- Handle incoming activity event ---
function handleActivityEvent(event) {
  // Update agent card (all event types)
  updateAgentCard(event);

  // Add to feed (skip status_change — only workflow + personality events)
  if (event.type !== 'status_change') {
    addToFeed(event, true);
  }
}

// --- Create agent card ---
function createAgentCard(agent) {
  const card = document.createElement('div');
  card.className = 'agent-card';
  card.id = `agent-${agent.id}`;
  card.style.setProperty('--agent-color', agent.color || '#6B7280');

  const phase = agent.phase || 'idle';
  const mood = agent.mood || 'neutral';
  const statusInfo = PHASE_STATUS[phase] || PHASE_STATUS.idle;

  card.innerHTML = `
    <div class="agent-header">
      <span class="agent-avatar">${agent.avatar || ''}</span>
      <div>
        <div class="agent-name">${agent.name}</div>
        <div class="agent-status ${statusInfo.class}">${statusInfo.label}</div>
      </div>
      <span class="agent-mood">${MOOD_EMOJI[mood] || ''}</span>
    </div>
    <div class="agent-task" style="display: none;"></div>
    <div class="agent-bubble">
      <span class="bubble-text">${agent.lastEvent?.message || '...'}</span>
    </div>
  `;

  // Add idle breathing animation if idle
  if (phase === 'idle') {
    card.classList.add('breathing');
  }

  return card;
}

// --- Update agent card with new event ---
function updateAgentCard(event) {
  const card = document.getElementById(`agent-${event.agentId}`);
  if (!card) return;

  // Update status
  const phase = event.phase || 'idle';
  const mood = event.mood || 'neutral';
  const statusInfo = PHASE_STATUS[phase] || PHASE_STATUS.idle;

  const statusEl = card.querySelector('.agent-status');
  if (statusEl) {
    statusEl.textContent = statusInfo.label;
    statusEl.className = `agent-status ${statusInfo.class}`;
  }

  // Update mood
  const moodEl = card.querySelector('.agent-mood');
  if (moodEl) {
    moodEl.textContent = MOOD_EMOJI[mood] || '';
  }

  // Update current task display (workflow events only)
  const taskEl = card.querySelector('.agent-task');
  if (taskEl) {
    if (event.type === 'workflow' && event.phase === 'task_received' && event.metadata?.taskContent) {
      const preview = String(event.metadata.taskContent);
      taskEl.textContent = preview.length > 50 ? preview.substring(0, 50) + '...' : preview;
      taskEl.style.display = 'block';
    } else if (event.phase === 'completed' || event.phase === 'idle') {
      taskEl.style.display = 'none';
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
}

// --- Typewriter effect ---
const activeTypewriters = new WeakMap();

function typewriterEffect(el, text) {
  // Cancel any ongoing typewriter on this element
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

// --- Add event to activity feed ---
function addToFeed(event, animate) {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;

  const item = document.createElement('div');
  const isWorkflow = event.type === 'workflow';
  item.className = `feed-item ${isWorkflow ? 'feed-workflow' : 'feed-personality'} ${animate ? 'feed-enter' : ''}`;
  item.dataset.timestamp = event.timestamp;
  item.dataset.eventType = isWorkflow ? 'workflow' : 'personality';
  item.dataset.agentId = event.agentId || '';

  // Apply current filter
  if (!matchesFilter(item)) {
    item.style.display = 'none';
  }

  const agentState = agentCards[event.agentId] || {};
  const avatar = agentState.avatar || '';
  const color = agentState.color || '#6B7280';
  const name = event.agentName || event.agentId;

  if (isWorkflow) {
    const phaseIcon = WORKFLOW_ICONS[event.phase] || '▸';
    item.innerHTML = `
      <span class="feed-workflow-icon">${phaseIcon}</span>
      <span class="feed-name" style="color: ${color}">${name}</span>
      <span class="feed-workflow-message">${escapeHtml(event.message)}</span>
      <span class="feed-time">${relativeTime(event.timestamp)}</span>
    `;
  } else {
    item.innerHTML = `
      <span class="feed-avatar" style="color: ${color}">${avatar}</span>
      <span class="feed-name" style="color: ${color}">${name}</span>
      <span class="feed-message">${escapeHtml(event.message)}</span>
      <span class="feed-time">${relativeTime(event.timestamp)}</span>
    `;
  }

  // Prepend (newest first)
  feed.prepend(item);

  // Limit feed size
  while (feed.children.length > MAX_FEED_ITEMS) {
    feed.removeChild(feed.lastChild);
  }

  activityFeed.unshift(event);
  if (activityFeed.length > MAX_FEED_ITEMS) {
    activityFeed.pop();
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

  if (diff < 10) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString();
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

// --- Filters ---
function initFilters() {
  const container = document.getElementById('feed-filters');
  if (!container) return;

  // Add per-agent filter buttons after agent cards are loaded
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

  // Click handler for all filter buttons
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

// --- Start ---
document.addEventListener('DOMContentLoaded', init);
