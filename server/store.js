const sqliteStore = require('./sqliteStore');
const googleAuth = require('./googleAuth');

function unavailable(message) {
  const error = new Error(message);
  error.status = 503;
  return error;
}

function current() {
  if (googleAuth.hasSession()) return require('./driveStore');
  if (googleAuth.sessionUnavailable()) {
    throw unavailable('Could not reach the saved Google Drive connection. Try again in a moment.');
  }
  // Vercel's disk is wiped on every redeploy, so never keep records there.
  if (process.env.VERCEL) {
    throw unavailable('Connect Google Drive to see and save records.');
  }
  return sqliteStore;
}

const store = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'driver') return current().driver;
    return (...args) => googleAuth.ready.then(() => {
      const target = current();
      if (typeof target[prop] !== 'function') return target[prop];
      return target[prop](...args);
    });
  },
});

module.exports = store;
