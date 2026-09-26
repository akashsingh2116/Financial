const sqliteStore = require('./sqliteStore');
const googleAuth = require('./googleAuth');

function current() {
  return googleAuth.hasSession() ? require('./driveStore') : sqliteStore;
}

const store = new Proxy({}, {
  get(_target, prop) {
    if (prop === 'driver') return current().driver;
    const value = current()[prop];
    if (typeof value !== 'function') return value;
    return (...args) => googleAuth.ready.then(() => current()[prop](...args));
  },
});

module.exports = store;
