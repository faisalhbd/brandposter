const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

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

// Keep-alive ping
app.get('/ping', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Convert short token to permanent
async function convertToPermanent(shortToken, pageId, appId, appSecret) {
  const llRes = await axios.get('https://graph.facebook.com/oauth/access_token', {
    params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken }
  });
  const longUserToken = llRes.data.access_token;

  const pagesRes = await axios.get('https://graph.facebook.com/v19.0/me/accounts', {
    params: { access_token: longUserToken }
  });
  const pages = pagesRes.data.data;
  const matchedPage = pages.find(p => p.id === pageId);

  if (matchedPage) {
    return { token: matchedPage.access_token, tokenInfo: { type: 'permanent', expiresAt: 'কখনো expire হবে না' } };
  } else {
    const exp = llRes.data.expires_in;
    const expDate = exp ? new Date(Date.now() + exp * 1000).toLocaleDateString('bn-BD') : '60 দিন';
    return { token: longUserToken, tokenInfo: { type: 'long-lived', expiresAt: expDate } };
  }
}

// Token convert endpoint (stateless)
app.post('/api/convert-token', async (req, res) => {
  const { token, pageId, appId, appSecret } = req.body;
  if (!token || !pageId || !appId || !appSecret) return res.status(400).json({ error: 'Missing fields' });
  try {
    const result = await convertToPermanent(token, pageId, appId, appSecret);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.response?.data?.error?.message || e.message });
  }
});

// Test account (stateless - token+pageId passed from client)
app.post('/api/test', async (req, res) => {
  const { token, pageId } = req.body;
  if (!token || !pageId) return res.status(400).json({ error: 'token ও pageId দরকার' });
  try {
    const r = await axios.get(`https://graph.facebook.com/v19.0/${pageId}`, {
      params: { fields: 'name,id', access_token: token }
    });
    res.json({ ok: true, name: r.data.name });
  } catch (e) {
    res.json({ ok: false, error: e.response?.data?.error?.message || e.message });
  }
});

// POST text (accounts passed from client)
app.post('/api/post/text', async (req, res) => {
  const { accounts, message } = req.body;
  if (!message || !accounts?.length) return res.status(400).json({ error: 'Message ও accounts দরকার' });
  const results = [];
  for (const acc of accounts) {
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
  const accs = JSON.parse(req.body.accounts || '[]');
  const results = [];
  for (const acc of accs) {
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
  const accs = JSON.parse(req.body.accounts || '[]');
  const results = [];
  for (const acc of accs) {
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
  console.log('ℹ️  Accounts browser-এ store হয় (localStorage) — server-এ কোনো data নেই');
});
