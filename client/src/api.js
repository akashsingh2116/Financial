import { loadOps, loadSnapshot, saveOps, saveSnapshot } from './offlineDb';
import {
  applyServerId,
  canSend,
  entryRecord,
  isLocalId,
  mergeRecords,
  noteRecord,
  queueOperation,
  readFormData,
} from './syncState';

const BASE = '/api';
const TOKEN_KEY = 'financeTrackerToken';

let authToken = localStorage.getItem(TOKEN_KEY) || null;

export function setToken(token) {
  authToken = token;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getToken() {
  return authToken;
}

function authHeaders(extra) {
  return authToken ? { ...extra, Authorization: `Bearer ${authToken}` } : { ...extra };
}

async function parseBody(res) {
  if (res.status === 204) return null;
  return res.json().catch(() => null);
}

// Used for authenticated endpoints: a 401 here means the session/token is no
// longer valid, so it clears the token and signals the app to show the login screen.
async function handle(res) {
  if (res.status === 401) {
    setToken(null);
    window.dispatchEvent(new Event('auth:unauthorized'));
    throw new Error('Session expired. Please log in again.');
  }
  const data = await parseBody(res);
  if (!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }
  return data;
}

// ---------- Auth ----------

export async function login(username, password) {
  let res;
  try {
    res = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch {
    throw new Error('No connection. Log in once while online, then you can add entries offline.');
  }
  // A 401 here just means wrong credentials, not an expired session, so this
  // is handled separately from the generic authenticated-request `handle`.
  const data = await parseBody(res);
  if (!res.ok) {
    throw new Error(data?.error || 'Invalid username or password');
  }
  setToken(data.token);
  return data;
}

export function logout() {
  fetch(`${BASE}/auth/logout`, { method: 'POST', headers: authHeaders() }).catch(() => {});
  setToken(null);
}

export async function googleStatus() {
  return handle(await send(`${BASE}/google/status`, { headers: authHeaders() }));
}

export async function startGoogleConnect() {
  const data = await handle(await send(`${BASE}/google/start`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ origin: window.location.origin }),
  }));
  window.location.assign(data.url);
}

export async function disconnectGoogle() {
  await handle(await send(`${BASE}/google/disconnect`, { method: 'POST', headers: authHeaders() }));
}

let chain = Promise.resolve();
let lastSyncError = '';

function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(() => {}, () => {});
  return run;
}

function offlineError() {
  const error = new Error('No connection. The change is saved on this device.');
  error.offline = true;
  return error;
}

async function send(url, options) {
  try {
    return await fetch(url, options);
  } catch {
    throw offlineError();
  }
}

async function publishStatus(offline = !navigator.onLine) {
  const ops = await loadOps();
  window.dispatchEvent(new CustomEvent('sync:status', {
    detail: { offline, pending: ops.length, error: lastSyncError },
  }));
}

function newLocalId() {
  return `local:${crypto.randomUUID()}`;
}

async function remember(operation) {
  const ops = queueOperation(await loadOps(), operation);
  await saveOps(ops);
  await publishStatus(!navigator.onLine);
}

function entryFormData(op) {
  const fields = [
    'serial_no', 'owner_name', 'product', 'issuer', 'amount', 'interest_rate',
    'maturity_amount', 'date_of_issue', 'date_of_maturity', 'nominee_name',
    'nominee_relation', 'premium_frequency', 'status', 'remarks', 'group_id',
  ];
  const formData = new FormData();
  for (const key of fields) {
    const value = op.record[key];
    formData.append(key, value == null ? '' : String(value));
  }
  if (op.removeDocument) formData.append('remove_document', 'true');
  if (op.file) {
    formData.append('document', new File([op.file.blob], op.file.name, { type: op.file.type }));
  }
  return formData;
}

function notePayload(record) {
  const entryId = record.entry_id;
  return {
    title: record.title,
    content: record.content,
    entry_id: entryId == null || entryId === '' ? null : Number(entryId),
  };
}

async function sendOp(op) {
  if (op.kind === 'group' && op.action === 'create') {
    const created = await handle(await send(`${BASE}/groups`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: op.record.name }),
    }));
    const rest = applyServerId((await loadOps()).filter((item) => item.id !== op.id), op.localId, created.id);
    await saveOps(rest);
    return;
  }
  if (op.kind === 'group' && op.action === 'update') {
    await handle(await send(`${BASE}/groups/${op.targetId}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ name: op.record.name }),
    }));
  } else if (op.kind === 'group' && op.action === 'delete') {
    const res = await send(`${BASE}/groups/${op.targetId}`, { method: 'DELETE', headers: authHeaders() });
    if (res.status !== 404) await handle(res);
  } else if (op.kind === 'entry' && op.action === 'create') {
    const created = await handle(await send(`${BASE}/entries`, {
      method: 'POST',
      headers: authHeaders(),
      body: entryFormData(op),
    }));
    const rest = applyServerId((await loadOps()).filter((item) => item.id !== op.id), op.localId, created.id);
    await saveOps(rest);
    return;
  }
  if (op.kind === 'entry' && op.action === 'update') {
    await handle(await send(`${BASE}/entries/${op.targetId}`, {
      method: 'PUT',
      headers: authHeaders(),
      body: entryFormData(op),
    }));
  } else if (op.kind === 'entry' && op.action === 'delete') {
    const res = await send(`${BASE}/entries/${op.targetId}`, { method: 'DELETE', headers: authHeaders() });
    if (res.status !== 404) await handle(res);
  } else if (op.kind === 'note' && op.action === 'create') {
    await handle(await send(`${BASE}/notes`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(notePayload(op.record)),
    }));
  } else if (op.kind === 'note' && op.action === 'update') {
    await handle(await send(`${BASE}/notes/${op.targetId}`, {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(notePayload(op.record)),
    }));
  } else if (op.kind === 'note' && op.action === 'delete') {
    const res = await send(`${BASE}/notes/${op.targetId}`, { method: 'DELETE', headers: authHeaders() });
    if (res.status !== 404) await handle(res);
  }
  await saveOps((await loadOps()).filter((item) => item.id !== op.id));
}

async function flushUnlocked() {
  if (!authToken || !navigator.onLine) {
    await publishStatus();
    return;
  }
  let ops = await loadOps();
  while (ops.length) {
    const index = ops.findIndex(canSend);
    if (index === -1) break;
    const op = ops[index];
    try {
      await sendOp(op);
      lastSyncError = '';
      ops = await loadOps();
    } catch (error) {
      if (!error.offline && !/session expired/i.test(error.message || '')) {
        lastSyncError = error.message || 'Could not sync saved changes';
      }
      await publishStatus(Boolean(error.offline));
      return;
    }
  }
  await publishStatus(false);
}

async function mergedList(kind, path) {
  await flushUnlocked();
  try {
    const rows = await handle(await send(path, { headers: authHeaders() }));
    await saveSnapshot(kind, rows);
    const merged = mergeRecords(rows, await loadOps(), kind);
    await publishStatus(false);
    return merged;
  } catch (error) {
    if (!error.offline && navigator.onLine) throw error;
    const merged = mergeRecords(await loadSnapshot(kind), await loadOps(), kind);
    await publishStatus(true);
    return merged;
  }
}

function openBlob(file) {
  const blob = file.blob instanceof Blob ? file.blob : new Blob([file.blob], { type: file.type });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- Entries ----------

export function listEntries() {
  return locked(() => mergedList('entry', `${BASE}/entries`));
}

export function createEntry(formData) {
  return locked(async () => {
    const parsed = readFormData(formData);
    if (navigator.onLine) {
      try {
        return await handle(await send(`${BASE}/entries`, { method: 'POST', headers: authHeaders(), body: formData }));
      } catch (error) {
        if (!error.offline) throw error;
      }
    }
    const localId = newLocalId();
    const record = entryRecord(localId, parsed, null);
    await remember({
      id: crypto.randomUUID(),
      kind: 'entry',
      action: 'create',
      localId,
      targetId: localId,
      record,
      file: parsed.file,
      at: Date.now(),
    });
    return record;
  });
}

export function updateEntry(id, formData) {
  return locked(async () => {
    const parsed = readFormData(formData);
    if (!isLocalId(id) && navigator.onLine) {
      try {
        return await handle(await send(`${BASE}/entries/${id}`, { method: 'PUT', headers: authHeaders(), body: formData }));
      } catch (error) {
        if (!error.offline) throw error;
      }
    }
    const existing = mergeRecords(await loadSnapshot('entry'), await loadOps(), 'entry')
      .find((row) => String(row.id) === String(id));
    const record = entryRecord(id, parsed, existing);
    await remember({
      id: crypto.randomUUID(),
      kind: 'entry',
      action: 'update',
      localId: isLocalId(id) ? id : null,
      targetId: id,
      record,
      file: parsed.file,
      removeDocument: parsed.removeDocument,
      at: Date.now(),
    });
    return record;
  });
}

export function deleteEntry(id) {
  return locked(async () => {
    if (!isLocalId(id) && navigator.onLine) {
      try {
        await handle(await send(`${BASE}/entries/${id}`, { method: 'DELETE', headers: authHeaders() }));
        return;
      } catch (error) {
        if (!error.offline) throw error;
      }
    }
    await remember({
      id: crypto.randomUUID(),
      kind: 'entry',
      action: 'delete',
      targetId: id,
      at: Date.now(),
    });
  });
}

export async function openDocument(id) {
  const queued = [...await loadOps()].reverse().find((op) => (
    op.kind === 'entry' && op.file && (String(op.localId) === String(id) || String(op.targetId) === String(id))
  ));
  if (isLocalId(id)) {
    if (!queued?.file) throw new Error('That document is not on this device yet.');
    openBlob(queued.file);
    return;
  }
  try {
    if (!navigator.onLine) throw offlineError();
    const res = await send(`${BASE}/entries/${id}/document`, { headers: authHeaders() });
    if (res.status === 401) {
      setToken(null);
      window.dispatchEvent(new Event('auth:unauthorized'));
      throw new Error('Session expired. Please log in again.');
    }
    if (!res.ok) {
      const data = await parseBody(res);
      throw new Error(data?.error || 'Could not open document');
    }
    const blob = await res.blob();
    openBlob({ blob, name: 'document', type: blob.type });
  } catch (error) {
    if (error.offline && queued?.file) {
      openBlob(queued.file);
      return;
    }
    if (error.offline) throw new Error('This document needs a connection.');
    throw error;
  }
}

// ---------- Notes ----------

export function listNotes() {
  return locked(() => mergedList('note', `${BASE}/notes`));
}

export function createNote(data) {
  return locked(async () => {
    if (navigator.onLine && !isLocalId(data.entry_id)) {
      try {
        return await handle(await send(`${BASE}/notes`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ ...data, entry_id: data.entry_id ? Number(data.entry_id) : null }),
        }));
      } catch (error) {
        if (!error.offline) throw error;
      }
    }
    const localId = newLocalId();
    const record = noteRecord(localId, data, null);
    await remember({
      id: crypto.randomUUID(),
      kind: 'note',
      action: 'create',
      localId,
      targetId: localId,
      record,
      at: Date.now(),
    });
    return record;
  });
}

export function updateNote(id, data) {
  return locked(async () => {
    if (!isLocalId(id) && navigator.onLine && !isLocalId(data.entry_id)) {
      try {
        return await handle(await send(`${BASE}/notes/${id}`, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ ...data, entry_id: data.entry_id ? Number(data.entry_id) : null }),
        }));
      } catch (error) {
        if (!error.offline) throw error;
      }
    }
    const existing = mergeRecords(await loadSnapshot('note'), await loadOps(), 'note')
      .find((row) => String(row.id) === String(id));
    const record = noteRecord(id, data, existing);
    await remember({
      id: crypto.randomUUID(),
      kind: 'note',
      action: 'update',
      targetId: id,
      record,
      at: Date.now(),
    });
    return record;
  });
}

export function listGroups() {
  return locked(() => mergedList('group', `${BASE}/groups`));
}

export function createGroup(name) {
  return locked(async () => {
    if (navigator.onLine) {
      try {
        return await handle(await send(`${BASE}/groups`, {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ name }),
        }));
      } catch (error) {
        if (!error.offline) throw error;
      }
    }
    const localId = newLocalId();
    const record = {
      id: localId,
      name,
      pending: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await remember({
      id: crypto.randomUUID(),
      kind: 'group',
      action: 'create',
      localId,
      targetId: localId,
      record,
      at: Date.now(),
    });
    return record;
  });
}

export function updateGroup(id, name) {
  return locked(async () => {
    if (!isLocalId(id) && navigator.onLine) {
      try {
        return await handle(await send(`${BASE}/groups/${id}`, {
          method: 'PUT',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ name }),
        }));
      } catch (error) {
        if (!error.offline) throw error;
      }
    }
    const existing = mergeRecords(await loadSnapshot('group'), await loadOps(), 'group')
      .find((row) => String(row.id) === String(id));
    const record = {
      id,
      name,
      pending: true,
      created_at: existing?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await remember({
      id: crypto.randomUUID(),
      kind: 'group',
      action: 'update',
      targetId: id,
      record,
      at: Date.now(),
    });
    return record;
  });
}

export function deleteGroup(id) {
  return locked(async () => {
    if (!isLocalId(id) && navigator.onLine) {
      try {
        await handle(await send(`${BASE}/groups/${id}`, { method: 'DELETE', headers: authHeaders() }));
        return;
      } catch (error) {
        if (!error.offline) throw error;
      }
    }
    await remember({
      id: crypto.randomUUID(),
      kind: 'group',
      action: 'delete',
      targetId: id,
      at: Date.now(),
    });
  });
}

export function deleteNote(id) {
  return locked(async () => {
    if (!isLocalId(id) && navigator.onLine) {
      try {
        await handle(await send(`${BASE}/notes/${id}`, { method: 'DELETE', headers: authHeaders() }));
        return;
      } catch (error) {
        if (!error.offline) throw error;
      }
    }
    await remember({
      id: crypto.randomUUID(),
      kind: 'note',
      action: 'delete',
      targetId: id,
      at: Date.now(),
    });
  });
}
