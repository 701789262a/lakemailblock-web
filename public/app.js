const state = {
  user: null,
  nodes: [],
  statusByNode: {},
  packets: [],
  packetPage: 1,
  packetPageSize: 20,
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

function setBannedMessage(msg, isErr = false) {
  const el = $('bannedMessage');
  el.textContent = msg || '';
  el.style.color = isErr ? '#9b2226' : '';
}

function renderNodeSelects() {
  const nodeOptions = ['<option value="">Nodo: tutti</option>']
    .concat(state.nodes.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`))
    .join('');

  $('packetNodeFilter').innerHTML = nodeOptions;
  $('unbanNodeSelect').innerHTML = nodeOptions;

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
  let packetRetry = 0;
  let packetBan = 0;
  for (const p of state.packets) {
    const action = normalizePacketAction(p);
    if (action === 'ok') packetOk += 1;
    if (action === 'retry') packetRetry += 1;
    if (action === 'ban') packetBan += 1;
  }

  $('cardTotalBanned').textContent = String(totalBanned);
  $('cardNodeCount').textContent = String(state.nodes.length);
  $('cardPacketOk').textContent = String(packetOk);
  $('cardPacketBan').textContent = String(packetBan);
  $('cardPacketRetry').textContent = String(packetRetry);
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
      rows.push(`
        <tr>
          <td>${escapeHtml(node)}</td>
          <td>${escapeHtml(ip)}</td>
          <td><button type="button" class="danger sm unban-one-btn" data-node="${escapeHtml(node)}" data-ip="${escapeHtml(ip)}">Unban</button></td>
        </tr>
      `);
    }
  }

  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="3">Nessun risultato</td></tr>';
}

function renderPacketsTable() {
  const tbody = $('packetsBody');
  const total = state.packets.length;
  const pageSize = Math.max(1, Number(state.packetPageSize || 20));
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (state.packetPage > totalPages) {
    state.packetPage = totalPages;
  }
  const page = Math.max(1, state.packetPage);
  const start = (page - 1) * pageSize;
  const pageItems = state.packets.slice(start, start + pageSize);

  const rows = pageItems.map((p) => {
    const action = normalizePacketAction(p);
    const cls = action === 'ban'
      ? 'packet-ban'
      : (action === 'retry' ? 'packet-retry' : (action === 'ok' ? 'packet-ok' : ''));
    const badgeCls = action === 'ban'
      ? 'ban'
      : (action === 'retry' ? 'retry' : (action === 'ok' ? 'ok' : ''));

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

  $('packetPageInfo').textContent = `Pagina ${page}/${totalPages} (${total} record)`;
  $('packetPrevBtn').disabled = page <= 1;
  $('packetNextBtn').disabled = page >= totalPages;
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
  syncConfigHighlight();
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

function normalizePacketAction(packet) {
  const raw = String((packet && packet.action) || '').toLowerCase();
  if (raw === 'ok' || raw === 'ban' || raw === 'retry') {
    return raw;
  }

  const message = String((packet && packet.message) || '').toUpperCase();
  if (message.includes('SMTP-GUARD RETRY')) {
    return 'retry';
  }
  if (message.includes('SMTP-GUARD BAN')) {
    return 'ban';
  }
  if (message.includes('SMTP-GUARD OK')) {
    return 'ok';
  }

  return raw || 'other';
}

function buildConfigHighlightHtml(text) {
  const src = String(text || '');
  const lines = src.split('\n');
  return lines.map((line) => {
    const escaped = escapeHtml(line);
    if (/^\s*#/.test(line)) {
      return `<span class="cfg-comment">${escaped}</span>`;
    }
    return escaped;
  }).join('\n');
}

function syncConfigHighlight() {
  const editor = $('configEditor');
  const highlight = $('configHighlight');
  if (!editor || !highlight) {
    return;
  }
  highlight.innerHTML = buildConfigHighlightHtml(editor.value);
  highlight.scrollTop = editor.scrollTop;
  highlight.scrollLeft = editor.scrollLeft;
}

function sortByNewestTs(items) {
  if (!Array.isArray(items)) {
    return [];
  }
  return [...items].sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));
}

function parseIpCsv(input) {
  return String(input || '')
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function requestUnban(node, ipList) {
  const uniqueIps = Array.from(new Set(ipList.map((x) => String(x).trim()).filter(Boolean)));
  if (!node) {
    throw new Error('Nodo obbligatorio');
  }
  if (!uniqueIps.length) {
    throw new Error('Nessun IP valido da sbannare');
  }

  const payload = {
    node,
    reason: 'web_manual_unban',
  };
  if (uniqueIps.length === 1) {
    payload.ip = uniqueIps[0];
  } else {
    payload.ips = uniqueIps;
  }

  return api('/api/unban', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
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
  const actionFilter = $('packetActionFilter').value;
  const ip = $('packetIpFilter').value.trim();
  const dpt = $('packetPortFilter').value.trim();
  const limit = $('packetLimit').value.trim() || '500';

  const params = new URLSearchParams();
  if (node) params.set('node', node);
  if (ip) params.set('ip', ip);
  if (dpt) params.set('dpt', dpt);
  params.set('limit', limit);

  const resp = await api(`/api/packets?${params.toString()}`);
  let packets = Array.isArray(resp.packets) ? resp.packets : [];
  if (actionFilter) {
    packets = packets.filter((p) => normalizePacketAction(p) === actionFilter);
  }
  state.packets = sortByNewestTs(packets);
  state.packetPage = 1;
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

$('bannedBody').addEventListener('click', async (ev) => {
  const btn = ev.target && ev.target.closest ? ev.target.closest('.unban-one-btn') : null;
  if (!btn) {
    return;
  }

  const node = btn.getAttribute('data-node') || '';
  const ip = btn.getAttribute('data-ip') || '';
  if (!node || !ip) {
    setBannedMessage('Dati nodo/IP mancanti', true);
    return;
  }

  if (!window.confirm(`Accodare unban di ${ip} su ${node}?`)) {
    return;
  }

  setBannedMessage(`Accodando unban ${ip} su ${node}...`);
  try {
    const resp = await requestUnban(node, [ip]);
    setBannedMessage(`Unban accodato (${resp.requestId || '-'}) per ${ip} su ${node}. Verrà eseguito al prossimo poll client.`);
  } catch (err) {
    setBannedMessage(`Unban fallito: ${err.message}`, true);
    return;
  }

  await reloadAll().catch(() => {});
});

$('unbanSubmitBtn').addEventListener('click', async () => {
  const node = $('unbanNodeSelect').value;
  const input = $('unbanIpInput').value;
  const ips = parseIpCsv(input);

  if (!node) {
    setBannedMessage('Seleziona un nodo per lo sbanno', true);
    return;
  }
  if (!ips.length) {
    setBannedMessage('Inserisci almeno un IP', true);
    return;
  }

  setBannedMessage(`Accodando unban di ${ips.length} IP su ${node}...`);
  try {
    const resp = await requestUnban(node, ips);
    setBannedMessage(`Unban accodato (${resp.requestId || '-'}) su ${node}: ${resp.count || ips.length} IP.`);
    $('unbanIpInput').value = '';
  } catch (err) {
    setBannedMessage(`Unban fallito: ${err.message}`, true);
    return;
  }

  await reloadAll().catch(() => {});
});

$('packetFilterBtn').addEventListener('click', async () => {
  await loadPackets();
  renderCards();
  renderPacketsTable();
});

$('configEditor').addEventListener('input', syncConfigHighlight);
$('configEditor').addEventListener('scroll', syncConfigHighlight);

$('packetPageSize').addEventListener('change', () => {
  const nextSize = Number($('packetPageSize').value || 20);
  state.packetPageSize = Number.isFinite(nextSize) && nextSize > 0 ? nextSize : 20;
  state.packetPage = 1;
  renderPacketsTable();
});

$('packetPrevBtn').addEventListener('click', () => {
  state.packetPage = Math.max(1, state.packetPage - 1);
  renderPacketsTable();
});

$('packetNextBtn').addEventListener('click', () => {
  const totalPages = Math.max(1, Math.ceil(state.packets.length / Math.max(1, state.packetPageSize)));
  state.packetPage = Math.min(totalPages, state.packetPage + 1);
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
