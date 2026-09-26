const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const UPLOAD_DIR = path.join(__dirname, 'uploads');
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const KEEP_SNAPSHOTS = 30;

function snapshotDatabase() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destination = path.join(BACKUP_DIR, `finance-${stamp}.db`);
  const sqlPath = destination.replaceAll('\\', '/').replaceAll("'", "''");
  db.exec(`VACUUM INTO '${sqlPath}'`);
  return destination;
}

function pruneSnapshots() {
  const snapshots = fs.readdirSync(BACKUP_DIR)
    .filter((name) => name.startsWith('finance-') && name.endsWith('.db'))
    .sort();
  const stale = snapshots.slice(0, Math.max(0, snapshots.length - KEEP_SNAPSHOTS));
  for (const name of stale) {
    fs.rmSync(path.join(BACKUP_DIR, name), { force: true });
  }
}

function mirrorUploads() {
  if (!fs.existsSync(UPLOAD_DIR)) return;
  const destDir = path.join(BACKUP_DIR, 'uploads');
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    if (name === '.gitkeep') continue;
    const from = path.join(UPLOAD_DIR, name);
    if (!fs.statSync(from).isFile()) continue;
    const to = path.join(destDir, name);
    if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
    fs.copyFileSync(from, to);
  }
}

function backupData() {
  try {
    const file = snapshotDatabase();
    pruneSnapshots();
    mirrorUploads();
    console.log(`Backup saved to ${file}`);
  } catch (err) {
    console.error('Backup failed:', err.message);
  }
}

module.exports = { backupData, BACKUP_DIR };
