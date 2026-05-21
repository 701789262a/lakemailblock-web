const path = require('path');

const axios = require('axios');
const dotenv = require('dotenv');
const express = require('express');
const session = require('express-session');

dotenv.config();

const app = express();

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8081);
const BACKEND_URL = (process.env.BACKEND_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-this-session-secret';
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: SESSION_TTL_MS,
  },
}));

function backendClient(token) {
  return axios.create({
    baseURL: BACKEND_URL,
    timeout: REQUEST_TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.token) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }
  return next();
}

function parsePositiveInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const floored = Math.floor(parsed);
  if (floored < min || floored > max) {
    return fallback;
  }
  return floored;
}

function normalizeError(err) {
  if (err.response) {
    return {
      status: err.response.status,
      detail: err.response.data || err.message,
    };
  }
  return {
    status: 500,
    detail: err.message || 'Unknown error',
  };
}

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ detail: 'username and password are required' });
  }

  try {
    const resp = await axios.post(`${BACKEND_URL}/api/login`, { username, password }, { timeout: REQUEST_TIMEOUT_MS });
    const token = resp.data && resp.data.token;
    const user = resp.data && resp.data.user;
    if (!token) {
      return res.status(502).json({ detail: 'Backend login did not return token' });
    }

    req.session.token = token;
    req.session.user = user || { username };

    return res.json({ status: 'ok', user: req.session.user });
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ status: 'ok' });
  });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.token) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }
  return res.json({ status: 'ok', user: req.session.user || null });
});

app.get('/api/backend-health', requireAuth, async (req, res) => {
  try {
    const client = backendClient(req.session.token);
    const resp = await client.get('/health');
    return res.json(resp.data);
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.get('/api/status', requireAuth, async (req, res) => {
  try {
    const client = backendClient(req.session.token);
    const resp = await client.get('/api/status');
    const byNode = resp.data || {};

    let totalBanned = 0;
    for (const ips of Object.values(byNode)) {
      totalBanned += Array.isArray(ips) ? ips.length : 0;
    }

    return res.json({
      status: 'ok',
      byNode,
      totalBanned,
      nodeCount: Object.keys(byNode).length,
    });
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.get('/api/packets', requireAuth, async (req, res) => {
  const node = typeof req.query.node === 'string' ? req.query.node : '';
  const action = typeof req.query.action === 'string' ? req.query.action : '';
  const ip = typeof req.query.ip === 'string' ? req.query.ip.trim() : '';
  const dpt = parsePositiveInt(req.query.dpt, null, 1, 65535);
  const fromTs = parsePositiveInt(req.query.fromTs, null, 0);
  const toTs = parsePositiveInt(req.query.toTs, null, 0);
  const limit = parsePositiveInt(req.query.limit, 500, 1, 5000);

  try {
    const client = backendClient(req.session.token);
    const params = { limit };
    if (node) params.node = node;
    if (action) params.action = action;
    if (fromTs !== null) params.fromTs = fromTs;
    if (toTs !== null) params.toTs = toTs;

    const resp = await client.get('/api/packets', { params });
    let packets = Array.isArray(resp.data && resp.data.packets) ? resp.data.packets : [];

    if (ip) {
      packets = packets.filter((p) => {
        const src = typeof p.src === 'string' ? p.src : '';
        const dst = typeof p.dst === 'string' ? p.dst : '';
        const pip = typeof p.ip === 'string' ? p.ip : '';
        return src.includes(ip) || dst.includes(ip) || pip.includes(ip);
      });
    }

    if (dpt !== null) {
      packets = packets.filter((p) => Number(p.dpt) === dpt);
    }

    packets.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));

    return res.json({
      status: 'ok',
      total: packets.length,
      packets,
    });
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.get('/api/logs', requireAuth, async (req, res) => {
  const params = {
    limit: parsePositiveInt(req.query.limit, 200, 1, 5000),
  };
  if (typeof req.query.node === 'string' && req.query.node) params.node = req.query.node;
  if (typeof req.query.type === 'string' && req.query.type) params.type = req.query.type;
  if (req.query.fromTs !== undefined) params.fromTs = req.query.fromTs;
  if (req.query.toTs !== undefined) params.toTs = req.query.toTs;

  try {
    const client = backendClient(req.session.token);
    const resp = await client.get('/api/logs', { params });
    return res.json(resp.data);
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.get('/api/configs', requireAuth, async (req, res) => {
  try {
    const client = backendClient(req.session.token);
    const resp = await client.get('/api/reverse/latest');
    return res.json(resp.data);
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.get('/api/configs/:node', requireAuth, async (req, res) => {
  try {
    const client = backendClient(req.session.token);
    const resp = await client.get(`/api/reverse/latest/${encodeURIComponent(req.params.node)}`);
    return res.json(resp.data);
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.post('/api/configs/refresh/:node', requireAuth, async (req, res) => {
  const node = req.params.node;
  try {
    const client = backendClient(req.session.token);
    const resp = await client.post('/api/reverse/refresh', { node, reason: 'web_manual_refresh' });
    return res.json(resp.data);
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.post('/api/configs/push', requireAuth, async (req, res) => {
  const { mode, node, nodes, ruleset, reason } = req.body || {};

  if (typeof ruleset !== 'string' || !ruleset.trim()) {
    return res.status(400).json({ detail: 'ruleset is required' });
  }

  const payload = {
    ruleset,
    reason: typeof reason === 'string' && reason ? reason : 'web_push',
  };

  if (mode === 'all') {
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return res.status(400).json({ detail: 'nodes[] is required for mode=all' });
    }
    payload.nodes = nodes;
  } else {
    if (typeof node !== 'string' || !node.trim()) {
      return res.status(400).json({ detail: 'node is required for single push' });
    }
    payload.node = node.trim();
  }

  try {
    const client = backendClient(req.session.token);
    const resp = await client.post('/api/config/push', payload);
    return res.json(resp.data);
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.post('/api/unban', requireAuth, async (req, res) => {
  const {
    node,
    ip,
    ips,
    reason,
  } = req.body || {};

  if (typeof node !== 'string' || !node.trim()) {
    return res.status(400).json({ detail: 'node is required' });
  }
  if (typeof ip !== 'string' && !Array.isArray(ips)) {
    return res.status(400).json({ detail: 'ip or ips[] is required' });
  }

  try {
    const client = backendClient(req.session.token);
    const resp = await client.post('/api/unban', {
      node: node.trim(),
      ip,
      ips,
      reason: typeof reason === 'string' && reason.trim() ? reason.trim() : 'web_manual_unban',
    });
    return res.json(resp.data);
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.get('/api/nodes', requireAuth, async (req, res) => {
  try {
    const client = backendClient(req.session.token);
    const [statusResp, cfgResp] = await Promise.all([
      client.get('/api/status'),
      client.get('/api/reverse/latest').catch(() => ({ data: { nodes: {} } })),
    ]);

    const nodes = new Set();
    Object.keys(statusResp.data || {}).forEach((n) => nodes.add(n));
    const cfgNodes = cfgResp.data && cfgResp.data.nodes ? Object.keys(cfgResp.data.nodes) : [];
    cfgNodes.forEach((n) => nodes.add(n));

    return res.json({ status: 'ok', nodes: Array.from(nodes).sort() });
  } catch (err) {
    const nerr = normalizeError(err);
    return res.status(nerr.status).json(nerr.detail);
  }
});

app.use('/', express.static(path.join(__dirname, '..', 'public'), {
  extensions: ['html'],
}));

app.listen(PORT, HOST, () => {
  console.log(`[WEB] lakemailblock-web listening on ${HOST}:${PORT}`);
  console.log(`[WEB] Backend URL: ${BACKEND_URL}`);
});
