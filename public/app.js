const state = {
  user: null,
  nodes: [],
  statusByNode: {},
  packets: [],
  configsByNode: {},
  selectedConfigNode: '',
  autoTimer: null,
};

const fmtIt = new Intl.DateTimeFormat('it-IT', {
  timeZone: 'Europe/Rome',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function $(id) {
  return document.getElementById(id);
}

function fmtTs(ts) {
  const v = Number(ts);
  if (!Number.isFinite(v) || v <= 0) {
    return '-';
  }
  return fmtIt.format(new Date(v * 1000));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });

  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { detail: text };
    }
  }

  if (!res.ok) {
    const message = body && (body.detail || body.error || JSON.stringify(body));
    const err = new Error(message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return body;
}

function showLogin() {
  $('loginView').classList.remove('hidden');
  $('appView').classList.add('hidden');
}

function showApp() {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
}

function setConfigMessage(msg, isErr = false) {
  const el = $('configMessage');
  el.textContent = msg || '';
  el.style.color = isErr ? '#9b2226' : '';
}

function renderNodeSelects() {
  const nodeOptions = ['<option value="">Nodo: tutti</option>']
    .concat(state.nodes.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`))
    .join('');

  $('packetNodeFilter').innerHTML = nodeOptions;

  const cfgOptions = state.nodes
    .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
    .join('');

  $('configNodeSelect').innerHTML = cfgOptions || '<option value="">(nessun nodo)</option>';

  if (state.selectedConfigNode && state.nodes.includes(state.selectedConfigNode)) {
    $('configNodeSelect').value = state.selectedConfigNode;
  } else if (state.nodes.length) {
    state.selectedConfigNode = state.nodes[0];
    $('configNodeSelect').value = state.selectedConfigNode;
  } else {
    state.selectedConfigNode = '';
  }
}

function renderCards() {
  const byNode = state.statusByNode || {};
  const totalBanned = Object.values(byNode).reduce((acc, ips) => acc + (Array.isArray(ips) ? ips.length : 0), 0);

  let packetOk = 0;
  let packetBan = 0;
  for (const p of state.packets) {
    if (p.action === 'ok') packetOk += 1;
    if (p.action === 'ban') packetBan += 1;
  }

  $('cardTotalBanned').textContent = String(totalBanned);
  $('cardNodeCount').textContent = String(state.nodes.length);
  $('cardPacketOk').textContent = String(packetOk);
  $('cardPacketBan').textContent = String(packetBan);
}

function renderBannedTable() {
  const tbody = $('bannedBody');
  const term = $('ipSearch').value.trim().toLowerCase();

  const rows = [];
  for (const node of Object.keys(state.statusByNode).sort()) {
    const ips = Array.isArray(state.statusByNode[node]) ? state.statusByNode[node] : [];
    for (const ip of ips) {
      const key = `${node} ${ip}`.toLowerCase();
      if (term && !key.includes(term)) {
        continue;
      }
      rows.push(`<tr><td>${escapeHtml(node)}</td><td>${escapeHtml(ip)}</td></tr>`);
    }
  }

  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="2">Nessun risultato</td></tr>';
}

function renderPacketsTable() {
  const tbody = $('packetsBody');
  const rows = state.packets.map((p) => {
    const action = String(p.action || '-');
    const cls = action === 'ban' ? 'packet-ban' : (action === 'ok' ? 'packet-ok' : '');
    const badgeCls = action === 'ban' ? 'ban' : (action === 'ok' ? 'ok' : '');

    return `
      <tr class="${cls}">
        <td>${escapeHtml(fmtTs(p.ts))}</td>
        <td>${escapeHtml(p.node || '-')}</td>
        <td><span class="badge ${badgeCls}">${escapeHtml(action)}</span></td>
        <td>${escapeHtml(p.src || '-')}</td>
        <td>${escapeHtml(p.dst || '-')}</td>
        <td>${escapeHtml(stringOrDash(p.spt))}</td>
        <td>${escapeHtml(stringOrDash(p.dpt))}</td>
        <td>${escapeHtml(p.proto || '-')}</td>
        <td>${escapeHtml(p.inIf || '-')}</td>
        <td>${escapeHtml(p.message || '-')}</td>
      </tr>
    `;
  });

  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="10">Nessun pacchetto</td></tr>';
}

function renderConfigMeta(node, entry) {
  const meta = $('configMeta');
  if (!node || !entry) {
    meta.innerHTML = '<div class="meta-item"><div class="k">Info</div><div class="v">Nessuna config caricata</div></div>';
    return;
  }

  const cfg = entry.config || {};
  const rows = [
    ['Nodo', node],
    ['Aggiornata', entry.updatedAt || '-'],
    ['Request ID', entry.requestId || '-'],
    ['Path', cfg.nftApplyPath || '-'],
    ['SHA256', cfg.nftablesConfSha256 || '-'],
    ['Validata lato server', entry.validation && entry.validation.validatedOnServer ? 'si' : 'no'],
  ];

  meta.innerHTML = rows
    .map(([k, v]) => `<div class="meta-item"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(String(v))}</div></div>`)
    .join('');
}

function renderConfigEditor() {
  const node = state.selectedConfigNode;
  const entry = node ? state.configsByNode[node] : null;
  const cfg = entry && entry.config ? entry.config : {};
  const text = (cfg.nftablesConf || cfg.ruleset || '').trim();

  $('configEditor').value = text;
  renderConfigMeta(node, entry);
}

function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function stringOrDash(v) {
  return v === undefined || v === null || v === '' ? '-' : String(v);
}

async function refreshBackendHealth() {
  try {
    await api('/api/backend-health');
    $('backendHealth').textContent = 'Backend: online';
    $('backendHealth').style.color = '#1f8f63';
  } catch {
    $('backendHealth').textContent = 'Backend: offline';
    $('backendHealth').style.color = '#9b2226';
  }
}

async function loadStatus() {
  const status = await api('/api/status');
  state.statusByNode = status.byNode || {};
}

async function loadNodes() {
  const data = await api('/api/nodes');
  state.nodes = Array.isArray(data.nodes) ? data.nodes : [];
}

async function loadPackets() {
  const node = $('packetNodeFilter').value;
  const action = $('packetActionFilter').value;
  const ip = $('packetIpFilter').value.trim();
  const dpt = $('packetPortFilter').value.trim();
  const limit = $('packetLimit').value.trim() || '500';

  const params = new URLSearchParams();
  if (node) params.set('node', node);
  if (action) params.set('action', action);
  if (ip) params.set('ip', ip);
  if (dpt) params.set('dpt', dpt);
  params.set('limit', limit);

  const resp = await api(`/api/packets?${params.toString()}`);
  state.packets = Array.isArray(resp.packets) ? resp.packets : [];
}

async function loadAllConfigs() {
  const resp = await api('/api/configs');
  state.configsByNode = (resp && resp.nodes) || {};
}

async function loadOneConfig(node) {
  const resp = await api(`/api/configs/${encodeURIComponent(node)}`);
  if (resp && resp.data) {
    state.configsByNode[node] = resp.data;
  }
}

async function reloadAll() {
  await Promise.all([
    loadNodes(),
    loadStatus(),
    loadPackets(),
    loadAllConfigs(),
    refreshBackendHealth(),
  ]);

  renderNodeSelects();
  renderCards();
  renderBannedTable();
  renderPacketsTable();
  renderConfigEditor();
}

function configureAutoRefresh() {
  if (state.autoTimer) {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  }

  const enabled = $('autoRefresh').checked;
  const sec = Math.max(3, Number($('refreshSeconds').value || 10));
  $('refreshSeconds').value = String(sec);

  if (!enabled) {
    return;
  }

  state.autoTimer = setInterval(() => {
    reloadAll().catch((err) => console.error('auto reload failed', err));
  }, sec * 1000);
}

async function onLoginSubmit(ev) {
  ev.preventDefault();
  $('loginError').textContent = '';

  const username = $('username').value.trim();
  const password = $('password').value;

  try {
    const resp = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    state.user = resp.user || { username };
    $('currentUser').textContent = `Utente: ${state.user.username || '-'} (${state.user.role || 'unknown'})`;

    showApp();
    await reloadAll();
    configureAutoRefresh();
  } catch (err) {
    $('loginError').textContent = err.message || 'Login fallito';
  }
}

async function onBoot() {
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    $('currentUser').textContent = `Utente: ${state.user.username || '-'} (${state.user.role || 'unknown'})`;

    showApp();
    await reloadAll();
    configureAutoRefresh();
  } catch {
    showLogin();
  }
}

$('loginForm').addEventListener('submit', onLoginSubmit);
$('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  if (state.autoTimer) {
    clearInterval(state.autoTimer);
    state.autoTimer = null;
  }
  showLogin();
});

$('manualRefreshBtn').addEventListener('click', () => {
  reloadAll().catch((err) => alert(err.message));
});

$('autoRefresh').addEventListener('change', configureAutoRefresh);
$('refreshSeconds').addEventListener('change', configureAutoRefresh);
$('ipSearch').addEventListener('input', renderBannedTable);

$('packetFilterBtn').addEventListener('click', async () => {
  await loadPackets();
  renderCards();
  renderPacketsTable();
});

$('configNodeSelect').addEventListener('change', async (ev) => {
  state.selectedConfigNode = ev.target.value;
  if (state.selectedConfigNode) {
    try {
      await loadOneConfig(state.selectedConfigNode);
    } catch {
      // keep old if request fails
    }
  }
  renderConfigEditor();
});

$('refreshConfigBtn').addEventListener('click', async () => {
  const node = $('configNodeSelect').value;
  if (!node) {
    setConfigMessage('Seleziona un nodo', true);
    return;
  }

  setConfigMessage(`Refresh config in corso su ${node}...`);
  try {
    await api(`/api/configs/refresh/${encodeURIComponent(node)}`, { method: 'POST' });
    await loadOneConfig(node);
    renderConfigEditor();
    setConfigMessage(`Config aggiornata da ${node}`);
  } catch (err) {
    setConfigMessage(`Refresh fallito: ${err.message}`, true);
  }
});

$('loadAllConfigsBtn').addEventListener('click', async () => {
  setConfigMessage('Refresh config di tutti i nodi in corso...');
  try {
    await loadAllConfigs();
    renderConfigEditor();
    setConfigMessage('Config di tutti i nodi aggiornate');
  } catch (err) {
    setConfigMessage(`Refresh globale fallito: ${err.message}`, true);
  }
});

$('pushSingleBtn').addEventListener('click', async () => {
  const node = $('configNodeSelect').value;
  const ruleset = $('configEditor').value;

  if (!node) {
    setConfigMessage('Seleziona un nodo', true);
    return;
  }

  setConfigMessage(`Push config a ${node} in corso...`);
  try {
    const resp = await api('/api/configs/push', {
      method: 'POST',
      body: JSON.stringify({ mode: 'single', node, ruleset, reason: 'web_editor_single_push' }),
    });
    setConfigMessage(`Push accodato: ${resp.count || 0} nodo`);
  } catch (err) {
    setConfigMessage(`Push fallito: ${err.message}`, true);
  }
});

$('pushAllBtn').addEventListener('click', async () => {
  const ruleset = $('configEditor').value;
  const nodes = [...state.nodes];

  if (!nodes.length) {
    setConfigMessage('Nessun nodo disponibile', true);
    return;
  }

  if (!window.confirm(`Inviare la config a TUTTI i nodi (${nodes.length})?`)) {
    return;
  }

  setConfigMessage(`Push globale a ${nodes.length} nodi in corso...`);
  try {
    const resp = await api('/api/configs/push', {
      method: 'POST',
      body: JSON.stringify({ mode: 'all', nodes, ruleset, reason: 'web_editor_push_all' }),
    });
    setConfigMessage(`Push globale accodato: ${resp.count || 0} nodi`);
  } catch (err) {
    setConfigMessage(`Push globale fallito: ${err.message}`, true);
  }
});

onBoot().catch((err) => {
  console.error(err);
  showLogin();
});
