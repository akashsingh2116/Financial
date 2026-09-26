const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sign } = require('./auth');

const TOKEN_PATH = path.join(__dirname, 'google-oauth.json');
const CLIENT_PATH = path.join(__dirname, 'google-client.json');
const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/drive.file',
].join(' ');

let session = null;
let access = { token: '', exp: 0 };

function clientConfig() {
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    return { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
  }
  if (!fs.existsSync(CLIENT_PATH)) return null;
  const parsed = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8'));
  if (!parsed.id || !parsed.secret) return null;
  return parsed;
}

function isConfigured() {
  return Boolean(clientConfig());
}

function hasSession() {
  return Boolean(session?.refresh_token);
}

function readTokenFile() {
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    return {
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
      email: process.env.GOOGLE_ACCOUNT_EMAIL || '',
      folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '',
      dataFileId: process.env.GOOGLE_DRIVE_DATA_FILE_ID || '',
    };
  }
  if (!fs.existsSync(TOKEN_PATH)) return null;
  return JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
}

function serviceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const parsed = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (typeof parsed.private_key === 'string') parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    return parsed;
  }
  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    || path.join(__dirname, 'firebase-service-account.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function firestore() {
  const credential = serviceAccount();
  if (!credential) return null;
  const { getApps, initializeApp, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    initializeApp({ credential: cert(credential) });
  }
  return getFirestore();
}

async function readTokenCloud() {
  const db = firestore();
  if (!db) return null;
  const snap = await db.collection('meta').doc('googleDrive').get();
  return snap.exists ? snap.data() : null;
}

async function writeSession(next) {
  session = next;
  access = { token: '', exp: 0 };
  const body = JSON.stringify(next, null, 2);
  await fs.promises.writeFile(TOKEN_PATH, body);
  const db = firestore();
  if (db) await db.collection('meta').doc('googleDrive').set(next);
}

const ready = (async () => {
  try {
    session = readTokenFile() || await readTokenCloud();
  } catch (error) {
    console.error('Google Drive session was not loaded:', error.message);
    session = readTokenFile();
  }
})();

function createState(redirectUri) {
  const payload = Buffer.from(JSON.stringify({
    r: redirectUri,
    exp: Date.now() + 10 * 60 * 1000,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function readState(state) {
  if (!state || !state.includes('.')) return null;
  const [payload, signature] = state.split('.');
  const expected = sign(payload);
  if (expected.length !== signature.length) return null;
  const { timingSafeEqual } = crypto;
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.r || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function startUrl(redirectUri, state) {
  const client = clientConfig();
  const params = new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'select_account consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

async function exchange(code, redirectUri) {
  const client = clientConfig();
  const body = new URLSearchParams({
    code,
    client_id: client.id,
    client_secret: client.secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json();
  if (!payload.refresh_token && !payload.access_token) {
    throw new Error(payload.error_description || payload.error || 'Google did not return access');
  }
  return payload;
}

async function emailFor(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  const payload = await response.json();
  return payload.email || '';
}

async function completeLogin(code, redirectUri) {
  const tokens = await exchange(code, redirectUri);
  const email = await emailFor(tokens.access_token);
  const previous = session && session.email === email ? session : {};
  await writeSession({
    refresh_token: tokens.refresh_token || previous.refresh_token,
    email,
    folderId: previous.folderId || '',
    dataFileId: previous.dataFileId || '',
  });
  if (!session.refresh_token) {
    throw new Error('Google did not grant offline access. Approve the request again.');
  }
  access = {
    token: tokens.access_token,
    exp: Date.now() + (tokens.expires_in || 3600) * 1000,
  };
  return session;
}

async function getAccessToken() {
  await ready;
  if (!hasSession()) {
    const error = new Error('Connect a Gmail account first');
    error.status = 409;
    throw error;
  }
  if (access.token && Date.now() < access.exp - 60000) return access.token;
  const client = clientConfig();
  const body = new URLSearchParams({
    client_id: client.id,
    client_secret: client.secret,
    refresh_token: session.refresh_token,
    grant_type: 'refresh_token',
  });
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json();
  if (!payload.access_token) {
    const error = new Error('Google Drive access expired. Connect Gmail again.');
    error.status = 401;
    throw error;
  }
  access = { token: payload.access_token, exp: Date.now() + (payload.expires_in || 3600) * 1000 };
  return access.token;
}

async function status() {
  await ready;
  return {
    configured: isConfigured(),
    connected: hasSession(),
    email: session?.email || '',
  };
}

async function disconnect() {
  await ready;
  session = null;
  access = { token: '', exp: 0 };
  await fs.promises.rm(TOKEN_PATH, { force: true });
  const db = firestore();
  if (db) await db.collection('meta').doc('googleDrive').delete();
}

function rememberDriveIds(folderId, dataFileId) {
  if (!session) return;
  if (session.folderId === folderId && session.dataFileId === dataFileId) return;
  return writeSession({ ...session, folderId, dataFileId });
}

module.exports = {
  ready,
  isConfigured,
  hasSession,
  createState,
  readState,
  startUrl,
  completeLogin,
  getAccessToken,
  status,
  disconnect,
  rememberDriveIds,
  get session() { return session; },
};
