const DB_NAME = 'finance-tracker';
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('snapshot')) db.createObjectStore('snapshot');
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(name, mode, run) {
  const db = await openDb();
  try {
    const tx = db.transaction(name, mode);
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    const result = await run(tx.objectStore(name));
    await done;
    return result;
  } finally {
    db.close();
  }
}

export function loadOps() {
  return withStore('outbox', 'readonly', (store) => requestToPromise(store.get('ops'))).then((ops) => ops || []);
}

export function saveOps(ops) {
  return withStore('outbox', 'readwrite', (store) => {
    store.put(ops, 'ops');
  });
}

export function loadSnapshot(name) {
  return withStore('snapshot', 'readonly', (store) => requestToPromise(store.get(name))).then((rows) => rows || []);
}

export function saveSnapshot(name, rows) {
  return withStore('snapshot', 'readwrite', (store) => {
    store.put(rows, name);
  });
}
