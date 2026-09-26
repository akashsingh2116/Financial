const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'application/pdf': '.pdf',
};

function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function loadCredential() {
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  const raw = filePath
    ? fs.readFileSync(filePath, 'utf8')
    : process.env.FIREBASE_SERVICE_ACCOUNT;
  const parsed = JSON.parse(raw);
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

const { getApps, initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');

if (!getApps().length) {
  initializeApp({
    credential: cert(loadCredential()),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const firestore = getFirestore();
const bucket = getStorage().bucket();

function rowFrom(snap) {
  if (!snap.exists) return null;
  return { ...snap.data(), id: Number(snap.id) };
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

async function nextId(counterName) {
  const ref = firestore.collection('meta').doc('counters');
  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists ? Number(snap.get(counterName) || 0) : 0;
    const next = current + 1;
    tx.set(ref, { [counterName]: next }, { merge: true });
    return next;
  });
}

async function commitInChunks(docs, fillBatch) {
  for (let index = 0; index < docs.length; index += 400) {
    const batch = firestore.batch();
    for (const doc of docs.slice(index, index + 400)) fillBatch(batch, doc);
    await batch.commit();
  }
}

module.exports = {
  driver: 'firebase',

  async listGroups() {
    const snap = await firestore.collection('groups').get();
    return snap.docs
      .map(rowFrom)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  },

  async getGroup(id) {
    const snap = await firestore.collection('groups').doc(String(id)).get();
    return rowFrom(snap);
  },

  async createGroup(name) {
    const id = await nextId('groups');
    const stamp = nowStamp();
    await firestore.runTransaction(async (tx) => {
      const clash = await tx.get(firestore.collection('groups').where('name', '==', name).limit(1));
      if (!clash.empty) throw conflict('A group with that name already exists');
      tx.set(firestore.collection('groups').doc(String(id)), {
        name,
        created_at: stamp,
        updated_at: stamp,
      });
    });
    return this.getGroup(id);
  },

  async updateGroup(id, name) {
    const ref = firestore.collection('groups').doc(String(id));
    await firestore.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (!existing.exists) return;
      const clash = await tx.get(firestore.collection('groups').where('name', '==', name).limit(1));
      const taken = clash.docs.some((doc) => doc.id !== String(id));
      if (taken) throw conflict('A group with that name already exists');
      tx.update(ref, { name, updated_at: nowStamp() });
    });
    return this.getGroup(id);
  },

  async deleteGroup(id) {
    const numericId = Number(id);
    const linked = await firestore.collection('entries').where('group_id', '==', numericId).get();
    await commitInChunks(linked.docs, (batch, doc) => {
      batch.update(doc.ref, { group_id: null, updated_at: nowStamp() });
    });
    await firestore.collection('groups').doc(String(id)).delete();
  },

  async listEntries() {
    const snap = await firestore.collection('entries').orderBy('date_of_maturity').get();
    return snap.docs.map(rowFrom);
  },

  async getEntry(id) {
    const snap = await firestore.collection('entries').doc(String(id)).get();
    return rowFrom(snap);
  },

  async createEntry(row) {
    const id = await nextId('entries');
    const stamp = nowStamp();
    await firestore.collection('entries').doc(String(id)).set({
      ...row,
      created_at: stamp,
      updated_at: stamp,
    });
    return this.getEntry(id);
  },

  async updateEntry(id, row) {
    await firestore.collection('entries').doc(String(id)).set({
      ...row,
      updated_at: nowStamp(),
    }, { merge: true });
    return this.getEntry(id);
  },

  async deleteEntry(id) {
    const numericId = Number(id);
    const notes = await firestore.collection('notes').where('entry_id', '==', numericId).get();
    await commitInChunks(notes.docs, (batch, doc) => {
      batch.update(doc.ref, { entry_id: null, updated_at: nowStamp() });
    });
    await firestore.collection('entries').doc(String(id)).delete();
  },

  async listNotes() {
    const snap = await firestore.collection('notes').orderBy('updated_at', 'desc').get();
    return snap.docs.map(rowFrom);
  },

  async getNote(id) {
    const snap = await firestore.collection('notes').doc(String(id)).get();
    return rowFrom(snap);
  },

  async createNote(row) {
    const id = await nextId('notes');
    const stamp = nowStamp();
    await firestore.collection('notes').doc(String(id)).set({
      title: row.title,
      content: row.content,
      entry_id: row.entry_id,
      created_at: stamp,
      updated_at: stamp,
    });
    return this.getNote(id);
  },

  async updateNote(id, row) {
    await firestore.collection('notes').doc(String(id)).set({
      title: row.title,
      content: row.content,
      entry_id: row.entry_id,
      updated_at: nowStamp(),
    }, { merge: true });
    return this.getNote(id);
  },

  async deleteNote(id) {
    await firestore.collection('notes').doc(String(id)).delete();
  },

  async saveFile(file) {
    const ext = path.extname(file.originalname) || EXT_BY_MIME[file.mimetype] || '';
    const objectPath = `documents/${Date.now()}-${crypto.randomUUID()}${ext}`;
    await bucket.file(objectPath).save(file.buffer, {
      resumable: false,
      metadata: { contentType: file.mimetype },
    });
    return objectPath;
  },

  async removeFile(storedPath) {
    if (!storedPath) return;
    await bucket.file(storedPath).delete({ ignoreNotFound: true });
  },

  async openFile(storedPath) {
    if (!storedPath) return null;
    const file = bucket.file(storedPath);
    const [exists] = await file.exists();
    if (!exists) return null;
    return { stream: file.createReadStream() };
  },
};
