export const ADMIN_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ClaudeCab Admin</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f7f9;
      --panel: #ffffff;
      --text: #1f2933;
      --muted: #657381;
      --line: #d9e0e7;
      --accent: #256f8f;
      --danger: #b3261e;
      --ok: #146c43;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      font-size: 14px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 20px;
      border-bottom: 1px solid var(--line);
      background: #fff;
      position: sticky;
      top: 0;
      z-index: 2;
    }
    h1 { font-size: 18px; margin: 0; font-weight: 700; }
    h2 { font-size: 15px; margin: 0 0 10px; }
    main {
      display: grid;
      grid-template-columns: minmax(280px, 360px) 1fr;
      gap: 16px;
      padding: 16px;
      max-width: 1280px;
      margin: 0 auto;
    }
    section {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }
    .stack { display: grid; gap: 12px; }
    .wide { min-width: 0; }
    .row { display: grid; gap: 6px; margin-bottom: 10px; }
    label { color: var(--muted); font-size: 12px; }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 9px;
      font: inherit;
      background: #fff;
      min-width: 0;
    }
    button {
      border: 1px solid var(--accent);
      background: var(--accent);
      color: #fff;
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
      cursor: pointer;
    }
    button.secondary {
      background: #fff;
      color: var(--accent);
    }
    button.danger {
      border-color: var(--danger);
      background: var(--danger);
    }
    button:disabled { opacity: .55; cursor: not-allowed; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .agent-list { display: grid; gap: 10px; }
    .agent {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: #fbfcfd;
    }
    .agent-title { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 360px;
      overflow: auto;
      background: #111827;
      color: #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      margin: 0;
    }
    .status { color: var(--muted); }
    .ok { color: var(--ok); }
    .err { color: var(--danger); }
    @media (max-width: 860px) {
      main { grid-template-columns: 1fr; padding: 10px; }
      header { align-items: stretch; flex-direction: column; }
    }
  </style>
</head>
<body>
  <header>
    <h1>ClaudeCab Admin</h1>
    <div class="toolbar">
      <input id="token" type="password" placeholder="Admin token" autocomplete="current-password">
      <button id="connect">連線</button>
      <span id="status" class="status">未連線</span>
    </div>
  </header>
  <main>
    <div class="stack">
      <section>
        <h2>Runtime</h2>
        <div id="runtime" class="status">-</div>
        <div class="toolbar" style="margin-top:10px">
          <button id="validate">Setup check</button>
          <button id="verify" class="secondary">Setup verify</button>
          <button id="restart" class="danger">Restart</button>
        </div>
      </section>
      <section>
        <h2>Output</h2>
        <pre id="output">Ready.</pre>
      </section>
    </div>
    <div class="stack wide">
      <section>
        <h2>Global Config</h2>
        <div id="global" class="grid"></div>
        <button id="save-global">儲存全域設定</button>
      </section>
      <section>
        <h2>Agents</h2>
        <div id="agents" class="agent-list"></div>
      </section>
    </div>
  </main>
  <script>
    const tokenInput = document.querySelector('#token');
    const statusEl = document.querySelector('#status');
    const outputEl = document.querySelector('#output');
    const globalEl = document.querySelector('#global');
    const agentsEl = document.querySelector('#agents');
    tokenInput.value = localStorage.getItem('claudecab.admin.token') || '';

    let snapshot = null;

    function headers() {
      return { 'content-type': 'application/json', authorization: 'Bearer ' + tokenInput.value };
    }
    function log(value) {
      outputEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }
    async function api(path, options = {}) {
      const res = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
      const text = await res.text();
      const body = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(body?.error || res.statusText);
      return body;
    }
    function fieldInput(field, prefix) {
      const id = prefix + '.' + field.key;
      const wrap = document.createElement('div');
      wrap.className = 'row';
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = field.label + (field.restartRequired ? ' *restart' : '');
      const input = document.createElement('input');
      input.id = id;
      input.dataset.key = field.key;
      input.dataset.original = field.secret ? '' : String(field.value ?? '');
      input.dataset.secret = String(field.secret);
      input.placeholder = field.secret && field.set ? '已設定，留空不變' : '';
      input.value = field.secret ? '' : String(field.value ?? '');
      wrap.append(label, input);
      return wrap;
    }
    function collect(container) {
      const values = {};
      for (const input of container.querySelectorAll('input[data-key]')) {
        const key = input.dataset.key;
        const isSecret = input.dataset.secret === 'true';
        if (isSecret && input.value === '') continue;
        if (!isSecret && input.value === input.dataset.original) continue;
        values[key] = input.value;
      }
      return values;
    }
    function renderConfig(data) {
      snapshot = data;
      globalEl.replaceChildren(...data.global.map((field) => fieldInput(field, 'global')));
      agentsEl.replaceChildren(...data.agents.map(renderAgent));
    }
    function renderAgent(agent) {
      const root = document.createElement('div');
      root.className = 'agent';
      const title = document.createElement('div');
      title.className = 'agent-title';
      title.innerHTML = '<strong>' + agent.id + '</strong><span class="pill">' + (agent.name || 'unnamed') + '</span>';
      const grid = document.createElement('div');
      grid.className = 'grid';
      for (const field of [...agent.agent, ...agent.settings, ...agent.providerEnv]) {
        grid.appendChild(fieldInput(field, 'agent.' + agent.id));
      }
      const save = document.createElement('button');
      save.textContent = '儲存 ' + agent.id;
      save.addEventListener('click', async () => {
        const inputs = [...grid.querySelectorAll('input[data-key]')];
        const agentValues = {};
        const settingsValues = {};
        const providerEnv = {};
        for (const input of inputs) {
          if (input.dataset.secret === 'true' && input.value === '') continue;
          if (input.dataset.secret !== 'true' && input.value === input.dataset.original) continue;
          const key = input.dataset.key;
          if (agent.agent.some((field) => field.key === key)) agentValues[key] = input.value;
          else if (agent.providerEnv.some((field) => field.key === key)) providerEnv[key] = input.value;
          else settingsValues[key] = input.value;
        }
        const body = { agent: agentValues, settings: settingsValues, providerEnv };
        log(await api('/api/agents/' + encodeURIComponent(agent.id), { method: 'PUT', body: JSON.stringify(body) }));
        await load();
      });
      root.append(title, grid, save);
      return root;
    }
    async function load() {
      statusEl.textContent = '連線中';
      localStorage.setItem('claudecab.admin.token', tokenInput.value);
      const status = await api('/api/status');
      document.querySelector('#runtime').textContent = status.message;
      renderConfig(await api('/api/config'));
      statusEl.textContent = '已連線';
      statusEl.className = 'ok';
    }
    document.querySelector('#connect').addEventListener('click', () => load().catch((err) => { statusEl.textContent = err.message; statusEl.className = 'err'; }));
    document.querySelector('#save-global').addEventListener('click', async () => {
      const values = collect(globalEl);
      log(await api('/api/config/global', { method: 'PUT', body: JSON.stringify({ values }) }));
      await load();
    });
    document.querySelector('#validate').addEventListener('click', async () => log(await api('/api/validate', { method: 'POST', body: JSON.stringify({ mode: 'check' }) })));
    document.querySelector('#verify').addEventListener('click', async () => log(await api('/api/validate', { method: 'POST', body: JSON.stringify({ mode: 'verify' }) })));
    document.querySelector('#restart').addEventListener('click', async () => {
      if (!confirm('Restart ClaudeCab?')) return;
      log(await api('/api/restart', { method: 'POST', body: '{}' }));
    });
  </script>
</body>
</html>`;
