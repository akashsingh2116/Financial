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
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
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

// ---------- Entries ----------

export function listEntries() {
  return fetch(`${BASE}/entries`, { headers: authHeaders() }).then(handle);
}

export function createEntry(formData) {
  return fetch(`${BASE}/entries`, { method: 'POST', headers: authHeaders(), body: formData }).then(handle);
}

export function updateEntry(id, formData) {
  return fetch(`${BASE}/entries/${id}`, { method: 'PUT', headers: authHeaders(), body: formData }).then(handle);
}

export function deleteEntry(id) {
  return fetch(`${BASE}/entries/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle);
}

export async function openDocument(id) {
  const res = await fetch(`${BASE}/entries/${id}/document`, { headers: authHeaders() });
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
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// ---------- Notes ----------

export function listNotes() {
  return fetch(`${BASE}/notes`, { headers: authHeaders() }).then(handle);
}

export function createNote(data) {
  return fetch(`${BASE}/notes`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(handle);
}

export function updateNote(id, data) {
  return fetch(`${BASE}/notes/${id}`, {
    method: 'PUT',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data),
  }).then(handle);
}

export function deleteNote(id) {
  return fetch(`${BASE}/notes/${id}`, { method: 'DELETE', headers: authHeaders() }).then(handle);
}
