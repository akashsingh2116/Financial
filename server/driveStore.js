const fs = require('node:fs');
const path = require('node:path');
const googleAuth = require('./googleAuth');

const FOLDER_NAME = 'Finance Tracker';
const DATA_NAME = 'finance-data.json';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

let chain = Promise.resolve();
let cache = null;

function locked(work) {
  const run = chain.then(work, work);
  chain = run.then(() => {}, () => {});
  return run;
}

function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function emptyData() {
  return { groups: [], entries: [], notes: [], counters: { groups: 0, entries: 0, notes: 0 } };
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

async function drive(url, options = {}) {
  const token = await googleAuth.getAccessToken();
  const response = await fetch(url, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (options.raw) return response;
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'Google Drive request failed');
    error.status = response.status === 401 ? 401 : 502;
    throw error;
  }
  return payload;
}

async function ensureFolder() {
  const saved = googleAuth.session?.folderId;
  if (saved) return saved;
  const query = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const listed = await drive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`);
  if (listed.files?.[0]?.id) return listed.files[0].id;
  const created = await drive('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  return created.id;
}

async function loadData() {
  if (cache) return cache;
  const folderId = await ensureFolder();
  let dataFileId = googleAuth.session?.dataFileId || '';
  if (!dataFileId) {
    const query = encodeURIComponent(`name='${DATA_NAME}' and '${folderId}' in parents and trashed=false`);
    const listed = await drive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`);
    dataFileId = listed.files?.[0]?.id || '';
  }
  let data = emptyData();
  if (dataFileId) {
    const response = await drive(`https://www.googleapis.com/drive/v3/files/${dataFileId}?alt=media`, { raw: true });
    if (response.ok) data = { ...emptyData(), ...await response.json() };
  }
  cache = { folderId, dataFileId, data };
  await googleAuth.rememberDriveIds(folderId, dataFileId);
  return cache;
}

async function saveData(snapshot) {
  const body = JSON.stringify(snapshot.data);
  if (!snapshot.dataFileId) {
    const boundary = `finance${Date.now()}`;
    const meta = JSON.stringify({ name: DATA_NAME, parents: [snapshot.folderId] });
    const payload = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    const created = await drive(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id`, {
      method: 'POST',
      headers: { 'content-type': `multipart/related; boundary=${boundary}` },
      body: payload,
    });
    snapshot.dataFileId = created.id;
    await googleAuth.rememberDriveIds(snapshot.folderId, snapshot.dataFileId);
    return;
  }
  await drive(`https://www.googleapis.com/upload/drive/v3/files/${snapshot.dataFileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

function nextId(data, name) {
  data.counters[name] = Number(data.counters[name] || 0) + 1;
  return data.counters[name];
}

async function uploadBuffer(buffer, name, mimeType) {
  const snapshot = await loadData();
  const boundary = `file${Date.now()}`;
  const meta = JSON.stringify({ name: name || 'document', parents: [snapshot.folderId] });
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType || 'application/octet-stream'}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const payload = Buffer.concat([Buffer.from(head), buffer, Buffer.from(tail)]);
  const created = await drive('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'content-type': `multipart/related; boundary=${boundary}` },
    body: payload,
  });
  return created.id;
}

const store = {
  driver: 'google-drive',

  async listGroups() {
    return locked(async () => {
      const { data } = await loadData();
      return [...data.groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    });
  },

  async getGroup(id) {
    return locked(async () => {
      const { data } = await loadData();
      return data.groups.find((group) => Number(group.id) === Number(id)) || null;
    });
  },

  async createGroup(name) {
    return locked(async () => {
      const snapshot = await loadData();
      if (snapshot.data.groups.some((group) => group.name === name)) throw conflict('A group with that name already exists');
      const stamp = nowStamp();
      const created = { id: nextId(snapshot.data, 'groups'), name, created_at: stamp, updated_at: stamp };
      snapshot.data.groups.push(created);
      await saveData(snapshot);
      return created;
    });
  },

  async updateGroup(id, name) {
    return locked(async () => {
      const snapshot = await loadData();
      const group = snapshot.data.groups.find((item) => Number(item.id) === Number(id));
      if (!group) return null;
      if (snapshot.data.groups.some((item) => item.name === name && Number(item.id) !== Number(id))) {
        throw conflict('A group with that name already exists');
      }
      group.name = name;
      group.updated_at = nowStamp();
      await saveData(snapshot);
      return group;
    });
  },

  async deleteGroup(id) {
    return locked(async () => {
      const snapshot = await loadData();
      snapshot.data.groups = snapshot.data.groups.filter((group) => Number(group.id) !== Number(id));
      for (const entry of snapshot.data.entries) {
        if (Number(entry.group_id) === Number(id)) entry.group_id = null;
      }
      await saveData(snapshot);
    });
  },

  async listEntries() {
    return locked(async () => {
      const { data } = await loadData();
      return [...data.entries].sort((a, b) => String(a.date_of_maturity).localeCompare(String(b.date_of_maturity)));
    });
  },

  async getEntry(id) {
    return locked(async () => {
      const { data } = await loadData();
      return data.entries.find((entry) => Number(entry.id) === Number(id)) || null;
    });
  },

  async createEntry(row) {
    return locked(async () => {
      const snapshot = await loadData();
      const stamp = nowStamp();
      const created = { ...row, id: nextId(snapshot.data, 'entries'), created_at: stamp, updated_at: stamp };
      snapshot.data.entries.push(created);
      await saveData(snapshot);
      return created;
    });
  },

  async updateEntry(id, row) {
    return locked(async () => {
      const snapshot = await loadData();
      const index = snapshot.data.entries.findIndex((entry) => Number(entry.id) === Number(id));
      if (index < 0) return null;
      const current = snapshot.data.entries[index];
      const updated = { ...current, ...row, id: current.id, created_at: current.created_at, updated_at: nowStamp() };
      snapshot.data.entries[index] = updated;
      await saveData(snapshot);
      return updated;
    });
  },

  async deleteEntry(id) {
    return locked(async () => {
      const snapshot = await loadData();
      snapshot.data.entries = snapshot.data.entries.filter((entry) => Number(entry.id) !== Number(id));
      for (const note of snapshot.data.notes) {
        if (Number(note.entry_id) === Number(id)) note.entry_id = null;
      }
      await saveData(snapshot);
    });
  },

  async listNotes() {
    return locked(async () => {
      const { data } = await loadData();
      return [...data.notes].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    });
  },

  async getNote(id) {
    return locked(async () => {
      const { data } = await loadData();
      return data.notes.find((note) => Number(note.id) === Number(id)) || null;
    });
  },

  async createNote(row) {
    return locked(async () => {
      const snapshot = await loadData();
      const stamp = nowStamp();
      const created = {
        id: nextId(snapshot.data, 'notes'),
        title: row.title,
        content: row.content,
        entry_id: row.entry_id,
        created_at: stamp,
        updated_at: stamp,
      };
      snapshot.data.notes.push(created);
      await saveData(snapshot);
      return created;
    });
  },

  async updateNote(id, row) {
    return locked(async () => {
      const snapshot = await loadData();
      const note = snapshot.data.notes.find((item) => Number(item.id) === Number(id));
      if (!note) return null;
      note.title = row.title;
      note.content = row.content;
      note.entry_id = row.entry_id;
      note.updated_at = nowStamp();
      await saveData(snapshot);
      return note;
    });
  },

  async deleteNote(id) {
    return locked(async () => {
      const snapshot = await loadData();
      snapshot.data.notes = snapshot.data.notes.filter((note) => Number(note.id) !== Number(id));
      await saveData(snapshot);
    });
  },

  async saveFile(file) {
    return locked(async () => uploadBuffer(file.buffer, file.originalname, file.mimetype));
  },

  async removeFile(storedPath) {
    if (!storedPath || storedPath.includes('/') || storedPath.includes('\\')) return;
    await drive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(storedPath)}`, { method: 'DELETE' }).catch(() => {});
  },

  async openFile(storedPath) {
    if (!storedPath) return null;
    const response = await drive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(storedPath)}?alt=media`, { raw: true });
    if (!response.ok) return null;
    const { Readable } = require('node:stream');
    return { stream: Readable.fromWeb(response.body) };
  },

  async importLocalSnapshot() {
    return locked(async () => {
      const snapshot = await loadData();
      if (snapshot.dataFileId) return false;
      const sqlite = require('./sqliteStore');
      const groups = await sqlite.listGroups();
      const entries = await sqlite.listEntries();
      const notes = await sqlite.listNotes();
      for (const entry of entries) {
        if (!entry.document_path) continue;
        const opened = await sqlite.openFile(entry.document_path);
        if (!opened?.filePath) {
          entry.document_path = null;
          continue;
        }
        const buffer = await fs.promises.readFile(opened.filePath);
        const ext = path.extname(opened.filePath).toLowerCase();
        const mime = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
          '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
        }[ext] || 'application/octet-stream';
        entry.document_path = await uploadBuffer(buffer, entry.document_original_name || path.basename(opened.filePath), mime);
      }
      const maxId = (rows) => rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
      snapshot.data = {
        groups,
        entries,
        notes,
        counters: { groups: maxId(groups), entries: maxId(entries), notes: maxId(notes) },
      };
      await saveData(snapshot);
      cache = snapshot;
      return true;
    });
  },
};

module.exports = store;
