const crypto = require('node:crypto');

const USERNAME = process.env.AUTH_USERNAME || 'akash';
const PASSWORD = process.env.AUTH_PASSWORD || 'Finance@123';
const SECRET = process.env.AUTH_SECRET
  || crypto.createHash('sha256').update(`finance:${PASSWORD}`).digest();

const WEEK = 7 * 24 * 60 * 60 * 1000;

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function login(username, password) {
  if (username !== USERNAME || password !== PASSWORD) return null;
  const payload = Buffer.from(JSON.stringify({
    u: username,
    exp: Date.now() + WEEK,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function isValidToken(token) {
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  const expected = sign(payload);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(actualBuf, expectedBuf)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now();
  } catch {
    return false;
  }
}

function logout() {}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { login, isValidToken, logout, requireAuth, sign };
