const crypto = require('node:crypto');

const USERNAME = process.env.AUTH_USERNAME || 'akash';
const PASSWORD = process.env.AUTH_PASSWORD || 'Finance@123';

const activeTokens = new Set();

function login(username, password) {
  if (username === USERNAME && password === PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    activeTokens.add(token);
    return token;
  }
  return null;
}

function isValidToken(token) {
  return Boolean(token) && activeTokens.has(token);
}

function logout(token) {
  activeTokens.delete(token);
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!isValidToken(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { login, isValidToken, logout, requireAuth };
