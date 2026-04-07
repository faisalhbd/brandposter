const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_FILE = path.join(__dirname, 'accounts.json');

const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Keep-alive ping endpoint (cron-job.org থেকে call করবে) ──────────────
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

function loadAccounts() {
  if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  return [];
}
function saveAccounts(a) { fs.writeFileSync(DATA_FILE, JSON.stringify(a, null, 2)); }

// Convert short token to permanent using per-account credentials
async function convertToPermanent(shortToken, pageId, appId, appSecret) {
  if (!appId || !appSecret) return { token: shortToken, tokenInfo: { type: 'short', expiresAt: '~1 ঘণ্টা' } };
  
  // Step 1: Short → Long-lived user token
  const llRes = await axios.get('https://graph.facebook.com/oauth/access_token', {
    params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken }
  });
  const longUserToken = llRes.data.access_token;
  console.log('✅ Long-lived user token পাওয়া গেছে');

  // Step 2: Get permanent page token
  const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
    params: { access_token: longUserToken }
  });
  const pages = pagesRes.data.data;
  console.log('📄 Pages:', pages.map(p => p.name + ' (' + p.id + ')'));

  const matchedPage = pages.find(p => p.id === pageId);
  if (matchedPage) {
    console.log('✅ Permanent page token পাওয়া গেছে!');
    return { token: matchedPage.access_token, tokenInfo: { type: 'permanent', expiresAt: 'কখনো expire হবে না' } };
  } else {
    // fallback: long-lived user token (60 days)
    const exp = llRes.data.expires_in;
    const expDate = exp ? new Date(Date.now() + exp * 1000).toLocaleDateString('bn-BD') : '60 দিন';
    return { token: longUserToken, tokenInfo: { type: 'long-lived', expiresAt: expDate } };
  }
}

// GET accounts (hide secrets before sending)
app.get('/api/accounts', (req, res) => {
  const accounts = loadAccounts().map(a => ({
    ...a,
    appSecret: a.appSecret ? '••••••••' : '',
    hasCredentials: !!(a.appId && a.appSecret)
  }));
  res.json(accounts);
});

// POST add account
app.post('/api/accounts', async (req, res) => {
  const { name, type, pageId, token, appId, appSecret } = req.body;
  if (!name || !pageId || !token) return res.status(400).json({ error: 'সব field দরকার' });

  let finalToken = token;
  let tokenInfo = { type: 'short', expiresAt: '~1 ঘণ্টা' };

  if (appId && appSecret) {
    try {
      const result = await convertToPermanent(token, pageId, appId, appSecret);
      finalToken = result.token;
      tokenInfo = result.tokenInfo;
    } catch (e) {
      console.log('⚠️ Token convert failed:', e.response?.data?.error?.message || e.message);
      tokenInfo = { type: 'short', expiresAt: '~1 ঘণ্টা', warning: e.response?.data?.error?.message || e.message };
    }
  }

  const accounts = loadAccounts();
  const newAcc = { id: Date.now(), name, type, pageId, token: finalToken, appId: appId||'', appSecret: appSecret||'', tokenInfo, active: true };
  accounts.push(newAcc);
  saveAccounts(accounts);

  res.json({ ...newAcc, appSecret: appSecret ? '••••••••' : '', hasCredentials: !!(appId && appSecret) });
});

// DELETE
app.delete('/api/accounts/:id', (req, res) => {
  saveAccounts(loadAccounts().filter(a => a.id !== parseInt(req.params.id)));
  res.json({ ok: true });
});

// PATCH toggle
app.patch('/api/accounts/:id', (req, res) => {
  const accounts = loadAccounts();
  const acc = accounts.find(a => a.id === parseInt(req.params.id));
  if (!acc) return res.status(404).json({ error: 'Not found' });
  acc.active = !acc.active;
  saveAccounts(accounts);
  res.json({ ...acc, appSecret: acc.appSecret ? '••••••••' : '' });
});

// REFRESH token - uses account's own credentials
app.post('/api/accounts/:id/refresh', async (req, res) => {
  const { newToken } = req.body;
  const accounts = loadAccounts();
  const acc = accounts.find(a => a.id === parseInt(req.params.id));
  if (!acc) return res.status(404).json({ error: 'Not found' });

  let finalToken = newToken;
  let tokenInfo = { type: 'short', expiresAt: '~1 ঘণ্টা' };

  if (acc.appId && acc.appSecret) {
    try {
      const result = await convertToPermanent(newToken, acc.pageId, acc.appId, acc.appSecret);
      finalToken = result.token;
      tokenInfo = result.tokenInfo;
    } catch (e) {
      console.log('Refresh failed:', e.message);
    }
  }

  acc.token = finalToken;
  acc.tokenInfo = tokenInfo;
  saveAccounts(accounts);
  res.json({ ok: true, tokenInfo });
});

// UPDATE credentials for existing account
app.put('/api/accounts/:id/credentials', async (req, res) => {
  const { appId, appSecret, newToken } = req.body;
  const accounts = loadAccounts();
  const acc = accounts.find(a => a.id === parseInt(req.params.id));
  if (!acc) return res.status(404).json({ error: 'Not found' });

  acc.appId = appId;
  acc.appSecret = appSecret;

  // If new token provided, convert it
  const tokenToConvert = newToken || null;
  if (tokenToConvert && appId && appSecret) {
    try {
      const result = await convertToPermanent(tokenToConvert, acc.pageId, appId, appSecret);
      acc.token = result.token;
      acc.tokenInfo = result.tokenInfo;
    } catch (e) {
      return res.json({ ok: false, error: e.response?.data?.error?.message || e.message });
    }
  }

  saveAccounts(accounts);
  res.json({ ok: true, tokenInfo: acc.tokenInfo });
});

// TEST
app.get('/api/accounts/:id/test', async (req, res) => {
  const acc = loadAccounts().find(a => a.id === parseInt(req.params.id));
  if (!acc) return res.status(404).json({ error: 'Not found' });
  try {
    const r = await axios.get(`https://graph.facebook.com/v19.0/${acc.pageId}`, {
      params: { fields: 'name,id', access_token: acc.token }
    });
    res.json({ ok: true, data: r.data, tokenInfo: acc.tokenInfo });
  } catch (e) {
    res.json({ ok: false, error: e.response?.data?.error?.message || e.message });
  }
});

// POST text
app.post('/api/post/text', async (req, res) => {
  const { accountIds, message } = req.body;
  if (!message || !accountIds?.length) return res.status(400).json({ error: 'Message ও account দরকার' });
  const accounts = loadAccounts();
  const results = [];
  for (const id of accountIds) {
    const acc = accounts.find(a => a.id === parseInt(id));
    if (!acc) { results.push({ name: 'Unknown', ok: false, error: 'Account নেই' }); continue; }
    try {
      const r = await axios.post(`https://graph.facebook.com/v19.0/${acc.pageId}/feed`, { message, access_token: acc.token });
      results.push({ name: acc.name, ok: true, postId: r.data.id });
    } catch (e) {
      results.push({ name: acc.name, ok: false, error: e.response?.data?.error?.message || e.message });
    }
  }
  res.json({ results });
});

// POST image
app.post('/api/post/image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Image file দরকার' });
  const ids = Array.isArray(req.body.accountIds) ? req.body.accountIds : JSON.parse(req.body.accountIds || '[]');
  const accounts = loadAccounts();
  const results = [];
  for (const id of ids) {
    const acc = accounts.find(a => a.id === parseInt(id));
    if (!acc) { results.push({ name: 'Unknown', ok: false, error: 'Account নেই' }); continue; }
    try {
      const form = new FormData();
      form.append('source', fs.createReadStream(req.file.path), { filename: req.file.filename, contentType: req.file.mimetype });
      if (req.body.message) form.append('message', req.body.message);
      form.append('access_token', acc.token);
      const r = await axios.post(`https://graph.facebook.com/v19.0/${acc.pageId}/photos`, form, {
        headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity
      });
      results.push({ name: acc.name, ok: true, postId: r.data.id });
    } catch (e) {
      results.push({ name: acc.name, ok: false, error: e.response?.data?.error?.message || e.message });
    }
  }
  try { fs.unlinkSync(req.file.path); } catch(e) {}
  res.json({ results });
});

// POST video
app.post('/api/post/video', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Video file দরকার' });
  const ids = Array.isArray(req.body.accountIds) ? req.body.accountIds : JSON.parse(req.body.accountIds || '[]');
  const accounts = loadAccounts();
  const results = [];
  for (const id of ids) {
    const acc = accounts.find(a => a.id === parseInt(id));
    if (!acc) { results.push({ name: 'Unknown', ok: false, error: 'Account নেই' }); continue; }
    try {
      const form = new FormData();
      form.append('source', fs.createReadStream(req.file.path), { filename: req.file.filename, contentType: 'video/mp4' });
      if (req.body.message) form.append('description', req.body.message);
      if (req.body.title) form.append('title', req.body.title);
      form.append('access_token', acc.token);
      const r = await axios.post(`https://graph.facebook.com/v19.0/${acc.pageId}/videos`, form, {
        headers: form.getHeaders(), maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 180000
      });
      results.push({ name: acc.name, ok: true, postId: r.data.id });
    } catch (e) {
      results.push({ name: acc.name, ok: false, error: e.response?.data?.error?.message || e.message });
    }
  }
  try { fs.unlinkSync(req.file.path); } catch(e) {}
  res.json({ results });
});

app.listen(PORT, () => {
  console.log(`\n✅ BrandPoster চালু হয়েছে!`);
  console.log(`🌐 http://localhost:${PORT}\n`);
});
