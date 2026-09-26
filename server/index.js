const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const db = require('./db');
const { backupData } = require('./backup');
const { login, logout, requireAuth } = require('./auth');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
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

function toEntryRow(body) {
  return {
    serial_no: String(body.serial_no || '').trim(),
    owner_name: String(body.owner_name || '').trim(),
    product: String(body.product || '').trim(),
    issuer: body.issuer ? String(body.issuer).trim() : null,
    amount: Number(body.amount),
    maturity_amount: Number(body.maturity_amount),
    date_of_issue: String(body.date_of_issue || '').trim(),
    date_of_maturity: String(body.date_of_maturity || '').trim(),
    nominee_name: String(body.nominee_name || '').trim(),
    nominee_relation: body.nominee_relation ? String(body.nominee_relation).trim() : null,
    premium_frequency: body.premium_frequency ? String(body.premium_frequency).trim() : null,
    status: body.status ? String(body.status).trim() : 'active',
    remarks: body.remarks ? String(body.remarks).trim() : null,
  };
}

function validateEntry(row) {
  for (const field of REQUIRED_ENTRY_FIELDS) {
    const value = row[field];
    if (value === '' || value === null || value === undefined || Number.isNaN(value)) {
      return `Missing or invalid required field: ${field}`;
    }
  }
  return null;
}

function deleteFileIfExists(filename) {
  if (!filename) return;
  const filePath = path.join(UPLOAD_DIR, filename);
  fs.rm(filePath, { force: true }, () => {});
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

app.use('/api/entries', requireAuth);
app.use('/api/notes', requireAuth);

// ---------- Entries ----------

app.get('/api/entries', (req, res) => {
  const rows = db.prepare('SELECT * FROM entries ORDER BY date_of_maturity ASC').all();
  res.json(rows);
});

app.get('/api/entries/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Entry not found' });
  res.json(row);
});

app.get('/api/entries/:id/document', (req, res) => {
  const row = db.prepare(
    'SELECT document_path, document_original_name FROM entries WHERE id = ?'
  ).get(req.params.id);
  if (!row?.document_path) return res.status(404).json({ error: 'Document not found' });

  const filename = path.basename(row.document_path);
  const filePath = path.join(UPLOAD_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Document not found' });

  const ext = path.extname(filename).toLowerCase();
  const safeName = String(row.document_original_name || filename).replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', MIME_BY_EXT[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
  res.sendFile(filePath);
});

app.post('/api/entries', upload.single('document'), (req, res) => {
  const row = toEntryRow(req.body);
  const error = validateEntry(row);
  if (error) {
    if (req.file) deleteFileIfExists(req.file.filename);
    return res.status(400).json({ error });
  }

  const stmt = db.prepare(`
    INSERT INTO entries (
      serial_no, owner_name, product, issuer, amount, maturity_amount,
      date_of_issue, date_of_maturity, nominee_name, nominee_relation,
      premium_frequency, status, remarks, document_path, document_original_name
    ) VALUES (
      @serial_no, @owner_name, @product, @issuer, @amount, @maturity_amount,
      @date_of_issue, @date_of_maturity, @nominee_name, @nominee_relation,
      @premium_frequency, @status, @remarks, @document_path, @document_original_name
    )
  `);
  const result = stmt.run({
    ...row,
    document_path: req.file ? req.file.filename : null,
    document_original_name: req.file ? req.file.originalname : null,
  });

  const created = db.prepare('SELECT * FROM entries WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

app.put('/api/entries/:id', upload.single('document'), (req, res) => {
  const existing = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  if (!existing) {
    if (req.file) deleteFileIfExists(req.file.filename);
    return res.status(404).json({ error: 'Entry not found' });
  }

  const row = toEntryRow(req.body);
  const error = validateEntry(row);
  if (error) {
    if (req.file) deleteFileIfExists(req.file.filename);
    return res.status(400).json({ error });
  }

  const removeDocument = req.body.remove_document === 'true';
  let documentPath = existing.document_path;
  let documentOriginalName = existing.document_original_name;

  if (req.file) {
    deleteFileIfExists(existing.document_path);
    documentPath = req.file.filename;
    documentOriginalName = req.file.originalname;
  } else if (removeDocument) {
    deleteFileIfExists(existing.document_path);
    documentPath = null;
    documentOriginalName = null;
  }

  db.prepare(`
    UPDATE entries SET
      serial_no = @serial_no, owner_name = @owner_name, product = @product,
      issuer = @issuer, amount = @amount, maturity_amount = @maturity_amount,
      date_of_issue = @date_of_issue, date_of_maturity = @date_of_maturity,
      nominee_name = @nominee_name, nominee_relation = @nominee_relation,
      premium_frequency = @premium_frequency, status = @status, remarks = @remarks,
      document_path = @document_path, document_original_name = @document_original_name,
      updated_at = datetime('now')
    WHERE id = @id
  `).run({ ...row, document_path: documentPath, document_original_name: documentOriginalName, id: req.params.id });

  const updated = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  res.json(updated);
});

app.delete('/api/entries/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM entries WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Entry not found' });
  deleteFileIfExists(existing.document_path);
  db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Notes ----------

app.get('/api/notes', (req, res) => {
  const rows = db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all();
  res.json(rows);
});

app.post('/api/notes', (req, res) => {
  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Note content is required' });
  const title = req.body.title ? String(req.body.title).trim() : null;
  const entryId = req.body.entry_id ? Number(req.body.entry_id) : null;
  if (entryId && !db.prepare('SELECT id FROM entries WHERE id = ?').get(entryId)) {
    return res.status(400).json({ error: 'Linked entry does not exist' });
  }

  const result = db.prepare(
    'INSERT INTO notes (title, content, entry_id) VALUES (?, ?, ?)'
  ).run(title, content, entryId);

  const created = db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

app.put('/api/notes/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Note not found' });

  const content = String(req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Note content is required' });
  const title = req.body.title ? String(req.body.title).trim() : null;
  const entryId = req.body.entry_id ? Number(req.body.entry_id) : null;
  if (entryId && !db.prepare('SELECT id FROM entries WHERE id = ?').get(entryId)) {
    return res.status(400).json({ error: 'Linked entry does not exist' });
  }

  db.prepare(
    "UPDATE notes SET title = ?, content = ?, entry_id = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(title, content, entryId, req.params.id);

  const updated = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  res.json(updated);
});

app.delete('/api/notes/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM notes WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Note not found' });
  db.prepare('DELETE FROM notes WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// ---------- Error handling ----------

app.use((err, req, res, next) => {
  const clientError = err instanceof multer.MulterError || err.status === 400;
  if (!clientError) console.error(err);
  const status = clientError ? 400 : 500;
  res.status(status).json({
    error: clientError ? err.message : 'Something went wrong',
  });
});

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

const clientDist = path.join(__dirname, '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Finance dashboard running on http://localhost:${PORT}`);
  if (process.env.NODE_ENV === 'production' && !process.env.AUTH_PASSWORD) {
    console.warn('AUTH_PASSWORD is not set. Change it before using this on the public internet.');
  }
  backupData();
  setInterval(backupData, 24 * 60 * 60 * 1000).unref();
});
