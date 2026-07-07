export const ADMIN_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ClaudeCab 後台</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fa;
      --panel: #ffffff;
      --subtle: #f9fafb;
      --text: #1f2933;
      --muted: #667482;
      --line: #d8e0e8;
      --accent: #176b87;
      --accent-soft: #e7f3f7;
      --danger: #b3261e;
      --ok: #146c43;
      --warn: #8a5a00;
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
      background: var(--panel);
      position: sticky;
      top: 0;
      z-index: 2;
    }
    h1 { font-size: 18px; margin: 0; font-weight: 700; }
    h2 { font-size: 15px; margin: 0 0 6px; }
    h3 { font-size: 13px; margin: 0 0 8px; color: var(--text); }
    p { margin: 0; }
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
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .toolbar input { width: min(320px, 60vw); }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
    .row { display: grid; gap: 5px; align-content: start; }
    .label-line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    label { color: var(--text); font-size: 12px; font-weight: 650; }
    input, select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 9px;
      font: inherit;
      background: #fff;
      min-width: 0;
    }
    input:focus, select:focus, button:focus {
      outline: 2px solid #7cc4dd;
      outline-offset: 2px;
    }
    button {
      border: 1px solid var(--accent);
      background: var(--accent);
      color: #fff;
      border-radius: 6px;
      padding: 8px 10px;
      font: inherit;
      cursor: pointer;
      min-height: 36px;
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
    .hint, .help {
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .hint { margin-bottom: 10px; }
    .help { display: block; }
    .field-group {
      border-top: 1px solid var(--line);
      padding-top: 12px;
      margin-top: 12px;
    }
    .field-group:first-child {
      border-top: 0;
      padding-top: 0;
      margin-top: 0;
    }
    .agent-list { display: grid; gap: 12px; }
    .agent {
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 12px;
      background: var(--subtle);
    }
    .agent-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }
    .pill, .badge {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--muted);
      font-size: 12px;
      white-space: nowrap;
    }
    .badge.restart {
      color: var(--warn);
      border-color: #e4c987;
      background: #fff8e1;
    }
    .notice {
      border-radius: 8px;
      padding: 10px;
      background: var(--accent-soft);
      color: #17485c;
      line-height: 1.45;
      margin-bottom: 10px;
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
      .toolbar input { width: 100%; }
    }
  </style>
</head>
<body>
  <header>
    <h1>ClaudeCab 後台</h1>
    <div class="toolbar">
      <input id="token" type="password" placeholder="後台登入 token" autocomplete="current-password">
      <button id="connect">連線</button>
      <span id="status" class="status">尚未連線</span>
    </div>
  </header>
  <main>
    <div class="stack">
      <section>
        <h2>執行狀態</h2>
        <p id="runtime" class="status">連線後載入目前狀態。</p>
        <div class="toolbar" style="margin-top:10px">
          <button id="validate">檢查設定</button>
          <button id="verify" class="secondary">完整驗證</button>
          <button id="restart" class="danger">重啟服務</button>
        </div>
      </section>
      <section>
        <h2>操作結果</h2>
        <pre id="output">等待操作。</pre>
      </section>
    </div>
    <div class="stack wide">
      <section>
        <h2>全域部署設定</h2>
        <p class="hint">這裡只寫入 local config overlay。大多數全域設定需要重啟才會生效；DB 路徑、session/cache 調校、排程補跑細節維持預設值，不在後台開放。</p>
        <div id="global"></div>
        <button id="save-global">儲存全域設定</button>
      </section>
      <section>
        <h2>機器人設定</h2>
        <p class="hint">agent 基本資料寫入 agent.json；模型與 provider 憑證寫入 .claude/settings.local.json。改 token/channel 通常要重啟，改模型或 provider 則可能要關閉既有 SDK session。</p>
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
    const actionButtons = [...document.querySelectorAll('button')];
    tokenInput.value = localStorage.getItem('claudecab.admin.token') || '';

    function headers() {
      return { 'content-type': 'application/json', authorization: 'Bearer ' + tokenInput.value };
    }
    function log(value) {
      outputEl.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    }
    function setBusy(isBusy, message) {
      actionButtons.forEach((button) => { button.disabled = isBusy; });
      if (message) statusEl.textContent = message;
      statusEl.className = isBusy ? 'status' : statusEl.className;
    }
    function summarizeResult(result) {
      const lines = [];
      const updated = Array.isArray(result.updated) ? result.updated : [];
      lines.push(updated.length > 0 ? '已儲存：' + updated.join(', ') : '沒有需要儲存的變更。');
      if (result.restartRequired) lines.push('這些 runtime 設定需要重啟服務才會生效。');
      if (result.sessionCloseRecommended) lines.push('模型或 provider 變更後，既有對話可能要先關閉 SDK session 才會使用新設定。');
      log(lines.join('\\n'));
    }
    async function api(path, options = {}) {
      const res = await fetch(path, { ...options, headers: { ...headers(), ...(options.headers || {}) } });
      const text = await res.text();
      const body = text ? JSON.parse(text) : null;
      if (!res.ok) throw new Error(body?.error || res.statusText);
      return body;
    }
    function appendOption(select, value, text) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    }
    function createControl(field, id) {
      if (field.type === 'boolean') {
        const select = document.createElement('select');
        appendOption(select, '', '不覆寫（使用 .env 或預設值）');
        appendOption(select, 'true', 'true');
        appendOption(select, 'false', 'false');
        select.value = field.value === true ? 'true' : field.value === false ? 'false' : '';
        return select;
      }
      const input = document.createElement('input');
      input.type = field.secret ? 'password' : field.type === 'number' ? 'number' : 'text';
      input.value = field.secret ? '' : String(field.value ?? '');
      input.placeholder = field.placeholder || (field.secret && field.set ? '留空表示保留既有值' : '');
      if (field.required) input.required = true;
      return input;
    }
    function fieldControlValue(control) {
      if (control.dataset.type === 'boolean') {
        if (control.value === '') return null;
        return control.value === 'true';
      }
      if (control.dataset.type === 'number') {
        return control.value === '' ? null : Number(control.value);
      }
      return control.value === '' ? null : control.value;
    }
    function fieldInput(field, prefix, group) {
      const id = prefix + '.' + group + '.' + field.key;
      const wrap = document.createElement('div');
      wrap.className = 'row';
      const line = document.createElement('div');
      line.className = 'label-line';
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = field.label;
      line.appendChild(label);
      if (field.restartRequired) {
        const badge = document.createElement('span');
        badge.className = 'badge restart';
        badge.textContent = '需重啟';
        line.appendChild(badge);
      }
      const control = createControl(field, id);
      control.id = id;
      control.dataset.key = field.key;
      control.dataset.group = group;
      control.dataset.original = field.secret ? '' : String(field.value ?? '');
      control.dataset.secret = String(field.secret);
      control.dataset.type = field.type;
      wrap.append(line, control);
      if (field.help) {
        const help = document.createElement('small');
        help.className = 'help';
        help.textContent = field.help;
        wrap.appendChild(help);
      }
      return wrap;
    }
    function groupedFields(fields) {
      const groups = [];
      for (const field of fields) {
        let group = groups.find((item) => item.name === field.group);
        if (!group) {
          group = { name: field.group || '設定', fields: [] };
          groups.push(group);
        }
        group.fields.push(field);
      }
      return groups;
    }
    function renderGroupedFields(container, fields, prefix, updateGroup) {
      const fragments = groupedFields(fields).map((group) => {
        const root = document.createElement('div');
        root.className = 'field-group';
        const title = document.createElement('h3');
        title.textContent = group.name;
        const grid = document.createElement('div');
        grid.className = 'grid';
        for (const field of group.fields) grid.appendChild(fieldInput(field, prefix, updateGroup));
        root.append(title, grid);
        return root;
      });
      container.replaceChildren(...fragments);
    }
    function collect(container) {
      const values = {};
      for (const control of container.querySelectorAll('[data-key]')) {
        const key = control.dataset.key;
        const isSecret = control.dataset.secret === 'true';
        if (isSecret && control.value === '') continue;
        if (!isSecret && control.value === control.dataset.original) continue;
        values[key] = fieldControlValue(control);
      }
      return values;
    }
    function renderConfig(data) {
      renderGroupedFields(globalEl, data.global, 'global', 'global');
      agentsEl.replaceChildren(...data.agents.map(renderAgent));
    }
    function renderAgent(agent) {
      const root = document.createElement('div');
      root.className = 'agent';
      const title = document.createElement('div');
      title.className = 'agent-title';
      const name = document.createElement('strong');
      name.textContent = agent.id;
      const badge = document.createElement('span');
      badge.className = 'pill';
      badge.textContent = agent.name || '未命名';
      title.append(name, badge);

      const body = document.createElement('div');
      renderGroupedFields(body, [...agent.agent, ...agent.settings, ...agent.providerEnv], 'agent.' + agent.id, 'mixed');
      for (const control of body.querySelectorAll('[data-key]')) {
        const key = control.dataset.key;
        if (agent.agent.some((field) => field.key === key)) control.dataset.group = 'agent';
        else if (agent.providerEnv.some((field) => field.key === key)) control.dataset.group = 'providerEnv';
        else control.dataset.group = 'settings';
      }

      const save = document.createElement('button');
      save.textContent = '儲存 ' + agent.id;
      save.addEventListener('click', () => saveAgent(agent, body).catch(showError));
      root.append(title, body, save);
      return root;
    }
    async function saveAgent(agent, container) {
      const agentValues = {};
      const settingsValues = {};
      const providerEnv = {};
      for (const control of container.querySelectorAll('[data-key]')) {
        if (control.dataset.secret === 'true' && control.value === '') continue;
        if (control.dataset.secret !== 'true' && control.value === control.dataset.original) continue;
        const target = control.dataset.group === 'agent'
          ? agentValues
          : control.dataset.group === 'providerEnv'
            ? providerEnv
            : settingsValues;
        target[control.dataset.key] = fieldControlValue(control);
      }
      if (Object.keys(agentValues).length + Object.keys(settingsValues).length + Object.keys(providerEnv).length === 0) {
        log(agent.id + ' 沒有需要儲存的變更。');
        return;
      }
      setBusy(true, '正在儲存 agent...');
      try {
        const body = { agent: agentValues, settings: settingsValues, providerEnv };
        summarizeResult(await api('/api/agents/' + encodeURIComponent(agent.id), { method: 'PUT', body: JSON.stringify(body) }));
        await load();
      } finally {
        setBusy(false);
      }
    }
    async function load() {
      setBusy(true, '正在載入...');
      try {
        localStorage.setItem('claudecab.admin.token', tokenInput.value);
        const status = await api('/api/status');
        document.querySelector('#runtime').textContent = '後台已啟用，已載入 agent 數量：' + status.agents.length;
        renderConfig(await api('/api/config'));
        statusEl.textContent = '已連線';
        statusEl.className = 'ok';
      } finally {
        setBusy(false);
      }
    }
    function showError(error) {
      statusEl.textContent = error.message;
      statusEl.className = 'err';
      log('錯誤：' + error.message);
    }
    document.querySelector('#connect').addEventListener('click', () => load().catch(showError));
    document.querySelector('#save-global').addEventListener('click', async () => {
      const values = collect(globalEl);
      if (Object.keys(values).length === 0) {
        log('全域設定沒有需要儲存的變更。');
        return;
      }
      setBusy(true, '正在儲存全域設定...');
      try {
        summarizeResult(await api('/api/config/global', { method: 'PUT', body: JSON.stringify({ values }) }));
        await load();
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });
    document.querySelector('#validate').addEventListener('click', async () => {
      setBusy(true, '正在檢查設定...');
      try {
        log(await api('/api/validate', { method: 'POST', body: JSON.stringify({ mode: 'check' }) }));
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });
    document.querySelector('#verify').addEventListener('click', async () => {
      setBusy(true, '正在執行完整驗證...');
      try {
        log(await api('/api/validate', { method: 'POST', body: JSON.stringify({ mode: 'verify' }) }));
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });
    document.querySelector('#restart').addEventListener('click', async () => {
      if (!confirm('確定要重啟 ClaudeCab 嗎？')) return;
      setBusy(true, '正在送出重啟要求...');
      try {
        log(await api('/api/restart', { method: 'POST', body: '{}' }));
      } catch (error) {
        showError(error);
      } finally {
        setBusy(false);
      }
    });
  </script>
</body>
</html>`;
