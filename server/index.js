const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const store = require('./store');
const googleAuth = require('./googleAuth');
const { login, logout, requireAuth } = require('./auth');

const { DATA_DIR } = require('./paths');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      const error = new Error('Only image (jpg, png, webp, gif) or PDF files are allowed');
      error.status = 400;
      return cb(error);
    }
    cb(null, true);
  },
});

const app = express();
app.use(cors());
app.use(express.json());

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
};

const REQUIRED_ENTRY_FIELDS = [
  'serial_no', 'owner_name', 'product', 'amount', 'maturity_amount',
  'date_of_issue', 'date_of_maturity', 'nominee_name',
];

function optionalRate(value) {
  if (value === '' || value == null) return null;
  const rate = Number(value);
  return Number.isFinite(rate) ? rate : Number.NaN;
}

function toEntryRow(body) {
  return {
    serial_no: String(body.serial_no || '').trim(),
    owner_name: String(body.owner_name || '').trim(),
    product: String(body.product || '').trim(),
    issuer: body.issuer ? String(body.issuer).trim() : null,
    amount: Number(body.amount),
    interest_rate: optionalRate(body.interest_rate),
    maturity_amount: Number(body.maturity_amount),
    date_of_issue: String(body.date_of_issue || '').trim(),
    date_of_maturity: String(body.date_of_maturity || '').trim(),
    nominee_name: String(body.nominee_name || '').trim(),
    nominee_relation: body.nominee_relation ? String(body.nominee_relation).trim() : null,
    premium_frequency: body.premium_frequency ? String(body.premium_frequency).trim() : null,
    status: body.status ? String(body.status).trim() : 'active',
    remarks: body.remarks ? String(body.remarks).trim() : null,
    group_id: optionalGroupId(body.group_id),
  };
}

function optionalGroupId(value) {
  if (value === '' || value == null) return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return Number.NaN;
  return id;
}

async function validateEntry(row) {
  for (const field of REQUIRED_ENTRY_FIELDS) {
    const value = row[field];
    if (value === '' || value === null || value === undefined || Number.isNaN(value)) {
      return `Missing or invalid required field: ${field}`;
    }
  }
  if (Number.isNaN(row.interest_rate) || (row.interest_rate != null && row.interest_rate < 0)) {
    return 'Invalid rate of interest';
  }
  if (Number.isNaN(row.group_id)) return 'Invalid group';
  if (row.group_id != null && !(await store.getGroup(row.group_id))) {
    return 'Group does not exist';
  }
  return null;
}

async function discardUpload(file) {
  if (!file?.filename) return;
  await store.removeFile(file.filename);
}

// ---------- Auth ----------

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  const token = login(String(username || ''), String(password || ''));
  if (!token) return res.status(401).json({ error: 'Invalid username or password' });
  res.json({ token });
});

app.post('/api/auth/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) logout(token);
  res.status(204).end();
});

const GOOGLE_ORIGINS = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4000',
  'https://financial.whoisakash.com',
  'https://financial-five-xi.vercel.app',
]);

function safeOrigin(value) {
  try {
    const origin = new URL(value).origin;
    return GOOGLE_ORIGINS.has(origin) ? origin : '';
  } catch {
    return '';
  }
}

app.get('/api/google/status', requireAuth, async (req, res) => {
  res.json(await googleAuth.status());
});

app.post('/api/google/start', requireAuth, (req, res) => {
  const origin = safeOrigin(req.body?.origin);
  if (!origin) return res.status(400).json({ error: 'This site cannot connect Google Drive' });
  if (!googleAuth.isConfigured()) {
    return res.status(503).json({ error: 'Google sign-in still needs an OAuth client in the Finance Tracker project' });
  }
  const redirectUri = `${origin}/api/google/callback`;
  res.json({ url: googleAuth.startUrl(redirectUri, googleAuth.createState(redirectUri)) });
});

app.get('/api/google/callback', async (req, res) => {
  const state = googleAuth.readState(String(req.query.state || ''));
  const origin = state ? safeOrigin(state.r) : '';
  const back = origin || 'http://localhost:5173';
  if (!state || !req.query.code) return res.redirect(`${back}/?google=error`);
  try {
    await googleAuth.completeLogin(String(req.query.code), state.r);
    await require('./driveStore').importLocalSnapshot();
    res.redirect(`${back}/?google=connected`);
  } catch (error) {
    console.error('Google connect failed:', error.message);
    const reason = encodeURIComponent(String(error.message || '').slice(0, 300));
    res.redirect(`${back}/?google=error&reason=${reason}`);
  }
});

app.post('/api/google/disconnect', requireAuth, async (req, res) => {
  await googleAuth.disconnect();
  res.status(204).end();
});

app.use('/api/entries', requireAuth);
app.use('/api/notes', requireAuth);
app.use('/api/groups', requireAuth);

function cleanGroupName(value) {
  return String(value || '').trim();
}

function rejectConflict(err, res) {
  if (err.status !== 409) throw err;
  res.status(409).json({ error: err.message });
  return true;
}

app.get('/api/groups', async (req, res) => {
  res.json(await store.listGroups());
});

// Sent by the browser with each create so a repeated request is saved only once.
function opId(req) {
  const value = String(req.get('x-op-id') || '');
  return /^[\w-]{8,64}$/.test(value) ? value : null;
}

app.post('/api/groups', async (req, res) => {
  const name = cleanGroupName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  if (name.length > 80) return res.status(400).json({ error: 'Group name must be 80 characters or less' });
  try {
    res.status(201).json(await store.createGroup(name, opId(req)));
  } catch (err) {
    if (!rejectConflict(err, res)) throw err;
  }
});

app.put('/api/groups/:id', async (req, res) => {
  const existing = await store.getGroup(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Group not found' });
  const name = cleanGroupName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  if (name.length > 80) return res.status(400).json({ error: 'Group name must be 80 characters or less' });
  try {
    res.json(await store.updateGroup(req.params.id, name));
  } catch (err) {
    if (!rejectConflict(err, res)) throw err;
  }
});

app.delete('/api/groups/:id', async (req, res) => {
  const existing = await store.getGroup(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Group not found' });
  await store.deleteGroup(req.params.id);
  res.status(204).end();
});

// ---------- Entries ----------

app.get('/api/entries', async (req, res) => {
  res.json(await store.listEntries());
});

app.get('/api/entries/:id', async (req, res) => {
  const row = await store.getEntry(req.params.id);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  res.json(row);
});

app.get('/api/entries/:id/document', async (req, res, next) => {
  const row = await store.getEntry(req.params.id);
  if (!row?.document_path) return res.status(404).json({ error: 'Document not found' });

  const opened = await store.openFile(row.document_path);
  if (!opened) return res.status(404).json({ error: 'Document not found' });

  const filename = path.basename(row.document_path);
  // Files kept in Google Drive are stored by id with no extension, so fall
  // back to the uploaded name; otherwise browsers cannot show the preview.
  const ext = (path.extname(filename) || path.extname(row.document_original_name || '')).toLowerCase();
  const safeName = String(row.document_original_name || filename).replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  if (opened.filePath) return res.sendFile(opened.filePath);
  opened.stream.on('error', next);
  opened.stream.pipe(res);
});

app.post('/api/entries', upload.single('document'), async (req, res) => {
  const row = toEntryRow(req.body);
  const error = await validateEntry(row);
  if (error) {
    await discardUpload(req.file);
    return res.status(400).json({ error });
  }

  let documentPath = null;
  try {
    if (req.file) documentPath = await store.saveFile(req.file);
    const created = await store.createEntry({
      ...row,
      document_path: documentPath,
      document_original_name: req.file ? req.file.originalname : null,
    }, opId(req));
    // A repeated request returns the first record; drop the second copy of its file.
    if (documentPath && created.document_path !== documentPath) await store.removeFile(documentPath);
    res.status(201).json(created);
  } catch (err) {
    if (documentPath) await store.removeFile(documentPath);
    throw err;
  }
});

app.put('/api/entries/:id', upload.single('document'), async (req, res) => {
  const existing = await store.getEntry(req.params.id);
  if (!existing) {
    await discardUpload(req.file);
    return res.status(404).json({ error: 'Entry not found' });
  }

  const row = toEntryRow(req.body);
  const error = await validateEntry(row);
  if (error) {
    await discardUpload(req.file);
    return res.status(400).json({ error });
  }

  const removeDocument = req.body.remove_document === 'true';
  let documentPath = existing.document_path;
  let documentOriginalName = existing.document_original_name;
  let storedNewFile = null;

  try {
    if (req.file) {
      storedNewFile = await store.saveFile(req.file);
      documentPath = storedNewFile;
      documentOriginalName = req.file.originalname;
    } else if (removeDocument) {
      documentPath = null;
      documentOriginalName = null;
    }

    const updated = await store.updateEntry(req.params.id, {
      ...row,
      document_path: documentPath,
      document_original_name: documentOriginalName,
    });

    if (req.file && existing.document_path && existing.document_path !== documentPath) {
      await store.removeFile(existing.document_path);
    } else if (removeDocument && existing.document_path) {
      await store.removeFile(existing.document_path);
    }
    res.json(updated);
  } catch (err) {
    if (storedNewFile) await store.removeFile(storedNewFile);
    throw err;
  }
});

app.delete('/api/entries/:id', async (req, res) => {
  const existing = await store.getEntry(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  await store.removeFile(existing.document_path);
  await store.deleteEntry(req.params.id);
  res.status(204).end();
});

// ---------- Notes ----------

app.get('/api/notes', async (req, res) => {
  res.json(await store.listNotes());
});

app.post('/api/notes', async (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Note content is required' });
  const title = req.body.title ? String(req.body.title).trim() : null;
  const entryId = req.body.entry_id ? Number(req.body.entry_id) : null;
  if (entryId && !(await store.getEntry(entryId))) {
    return res.status(400).json({ error: 'Linked entry does not exist' });
  }

  const created = await store.createNote({ title, content, entry_id: entryId }, opId(req));
  res.status(201).json(created);
});

app.put('/api/notes/:id', async (req, res) => {
  const existing = await store.getNote(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Note not found' });

  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Note content is required' });
  const title = req.body.title ? String(req.body.title).trim() : null;
  const entryId = req.body.entry_id ? Number(req.body.entry_id) : null;
  if (entryId && !(await store.getEntry(entryId))) {
    return res.status(400).json({ error: 'Linked entry does not exist' });
  }

  res.json(await store.updateNote(req.params.id, { title, content, entry_id: entryId }));
});

app.delete('/api/notes/:id', async (req, res) => {
  const existing = await store.getNote(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Note not found' });
  await store.deleteNote(req.params.id);
  res.status(204).end();
});

// ---------- Error handling ----------

app.use((err, req, res, next) => {
  const status = err instanceof multer.MulterError ? 400 : (Number(err.status) || 500);
  if (status >= 500) console.error(err);
  const safeStatus = status >= 400 && status < 600 ? status : 500;
  res.status(safeStatus).json({
    error: err.status || err instanceof multer.MulterError ? err.message : 'Something went wrong',
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const clientDist = [
  path.join(__dirname, '..', 'public'),
  path.join(__dirname, '..', 'client', 'dist'),
].find((dir) => fs.existsSync(path.join(dir, 'index.html')));

if (clientDist) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

if (require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Finance dashboard running on http://localhost:${PORT}`);
    if (process.env.NODE_ENV === 'production' && !process.env.AUTH_PASSWORD) {
      console.warn('AUTH_PASSWORD is not set. Change it before using this on the public internet.');
    }
    googleAuth.ready.then(() => {
      console.log(googleAuth.hasSession()
        ? `Data store: Google Drive (${googleAuth.session.email})`
        : 'Data store: local SQLite until a Gmail account is connected');
      if (!process.env.VERCEL && !googleAuth.hasSession()) {
        const { backupData } = require('./backup');
        backupData();
        setInterval(backupData, 24 * 60 * 60 * 1000).unref();
      }
    });
  });
}

module.exports = app;
