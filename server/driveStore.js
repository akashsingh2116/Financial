const fs = require('node:fs');
const path = require('node:path');
const googleAuth = require('./googleAuth');

const FOLDER_NAME = 'Finance Tracker';
const DATA_NAME = 'finance-data.json';
const SHEET_NAME = 'Finance Records';
const EXCEL_NAME = 'Finance Records.xlsx';
const EXCEL_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BACKUP_FOLDER = 'Backups';
const DOCUMENTS_FOLDER = 'Documents';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';

// Columns of the Finance Records sheet and Excel file. `type` sets how the
// value is stored and shown: text keeps leading zeros, dates are real dates.
const SHEET_COLUMNS = [
  { title: 'Group', type: 'text', pick: (entry, groups) => groups.get(Number(entry.group_id)) || '' },
  { title: 'Serial No', type: 'text', pick: (entry) => entry.serial_no },
  { title: 'Owner', type: 'text', pick: (entry) => entry.owner_name },
  { title: 'Product', type: 'text', pick: (entry) => entry.product },
  { title: 'Issuer', type: 'text', pick: (entry) => entry.issuer },
  { title: 'Amount', type: 'money', pick: (entry) => entry.amount },
  { title: 'Interest Rate (%)', type: 'number', pick: (entry) => entry.interest_rate },
  { title: 'Maturity Amount', type: 'money', pick: (entry) => entry.maturity_amount },
  { title: 'Date of Issue', type: 'date', pick: (entry) => entry.date_of_issue },
  { title: 'Date of Maturity', type: 'date', pick: (entry) => entry.date_of_maturity },
  { title: 'Nominee', type: 'text', pick: (entry) => entry.nominee_name },
  { title: 'Nominee Relation', type: 'text', pick: (entry) => entry.nominee_relation },
  { title: 'Premium Frequency', type: 'text', pick: (entry) => entry.premium_frequency },
  { title: 'Status', type: 'text', pick: (entry) => entry.status },
  { title: 'Remarks', type: 'text', pick: (entry) => entry.remarks },
  {
    title: 'Document',
    type: 'link',
    pick: (entry) => (entry.document_path
      ? { text: entry.document_original_name || 'Open', hyperlink: `https://drive.google.com/file/d/${entry.document_path}/view` }
      : ''),
  },
  { title: 'Added', type: 'text', pick: (entry) => entry.created_at },
  { title: 'Last Updated', type: 'text', pick: (entry) => entry.updated_at },
];

const HEADER_FILL = 'FFF9CB9C';
const BORDER_COLOR = 'FFD0D0D0';

let chain = Promise.resolve();
let cache = null;
let sheetId = '';
let excelId = '';

const DRIVE_TIMEOUT_MS = 20000;
const UPLOAD_TIMEOUT_MS = 60000;
const LABEL_BUDGET_MS = 5000;
const RECENT_OPS_LIMIT = 200;

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

// Runs one change at a time. When another server instance saved first, the
// change is re-run on fresh data instead of failing.
function locked(work) {
  const attempt = async () => {
    for (let tries = 0; ; tries += 1) {
      try {
        return await work();
      } catch (error) {
        if (!error.stale || tries >= 2) throw error;
        cache = null;
        await wait(200 * (tries + 1));
      }
    }
  };
  const run = chain.then(attempt, attempt);
  chain = run.then(() => {}, () => {});
  return run;
}

function nowStamp() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function emptyData() {
  return { groups: [], entries: [], notes: [], counters: { groups: 0, entries: 0, notes: 0 } };
}

function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

function stale() {
  const error = new Error('Records were changed somewhere else. Try again.');
  error.status = 503;
  error.stale = true;
  return error;
}

// Every Drive call has a time limit so one slow request cannot hold up the
// rest. Calls that are safe to repeat are retried on network errors, 429 and 5xx.
async function drive(url, options = {}) {
  const { raw, timeout, once, ...init } = options;
  const repeatable = !once && (init.method || 'GET') !== 'POST';
  for (let tries = 0; ; tries += 1) {
    const token = await googleAuth.getAccessToken();
    let response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeout || DRIVE_TIMEOUT_MS),
        headers: { authorization: `Bearer ${token}`, ...(init.headers || {}) },
      });
    } catch {
      if (repeatable && tries < 2) {
        await wait(500 * 2 ** tries);
        continue;
      }
      throw unreadable('Google Drive did not respond. Try again in a moment.');
    }
    if (repeatable && tries < 2 && (response.status === 429 || response.status >= 500)) {
      await wait(500 * 2 ** tries);
      continue;
    }
    if (raw) return response;
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = new Error(payload?.error?.message || 'Google Drive request failed');
      // Never 401: the browser treats that as its own login expiring.
      error.status = response.status === 400 || response.status === 404 ? 502 : 503;
      error.driveStatus = response.status;
      throw error;
    }
    return payload;
  }
}

async function ensureFolder() {
  const saved = googleAuth.session?.folderId;
  if (saved) return saved;
  const query = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const listed = await drive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`);
  if (listed.files?.[0]?.id) return listed.files[0].id;
  const created = await drive('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
  });
  return created.id;
}

function unreadable(message) {
  const error = new Error(message);
  error.status = 503;
  return error;
}

async function findDataFile(folderId) {
  const query = encodeURIComponent(`name='${DATA_NAME}' and '${folderId}' in parents and trashed=false`);
  const listed = await drive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`);
  return listed.files?.[0]?.id || '';
}

async function fileVersion(fileId) {
  const response = await drive(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=version,trashed`, { raw: true });
  if (response.status === 404) return null;
  if (!response.ok) throw unreadable('Could not check the records in Google Drive. Try again in a moment.');
  const meta = await response.json();
  return meta.trashed ? null : String(meta.version);
}

async function loadData() {
  // Other server instances (old and new ones overlap during a redeploy) may
  // have saved since this copy was read, so only reuse it if Drive agrees.
  if (cache?.dataFileId && await fileVersion(cache.dataFileId) === cache.version) return cache;
  cache = null;

  const folderId = await ensureFolder();
  let dataFileId = googleAuth.session?.dataFileId || '';
  let version = dataFileId ? await fileVersion(dataFileId) : null;
  if (!version) {
    dataFileId = await findDataFile(folderId);
    version = dataFileId ? await fileVersion(dataFileId) : null;
  }
  let data = emptyData();
  if (dataFileId && version) {
    const response = await drive(`https://www.googleapis.com/drive/v3/files/${dataFileId}?alt=media`, { raw: true });
    // Never fall back to empty data here: the next save would overwrite
    // every existing record with it.
    if (!response.ok) throw unreadable('Could not read the records from Google Drive. Try again in a moment.');
    let parsed;
    try {
      parsed = JSON.parse(await response.text());
    } catch {
      throw unreadable(`${DATA_NAME} in Google Drive could not be read. Restore it from a backup in the Backups folder.`);
    }
    data = {
      ...emptyData(),
      ...parsed,
      groups: Array.isArray(parsed.groups) ? parsed.groups : [],
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    };
  } else {
    dataFileId = '';
  }
  cache = { folderId, dataFileId, version, data };
  await googleAuth.rememberDriveIds(folderId, dataFileId);
  return cache;
}

function cleanName(value) {
  return String(value ?? '').replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function documentName(entry) {
  const ext = path.extname(entry.document_original_name || '').toLowerCase();
  const parts = [entry.owner_name, entry.product, entry.serial_no && `No ${entry.serial_no}`]
    .map(cleanName).filter(Boolean);
  return `${parts.join(' - ') || 'Record'} (Record #${entry.id})${ext}`;
}

function documentDescription(entry, groupName) {
  return [
    `Finance Tracker record #${entry.id}`,
    groupName && `Group: ${groupName}`,
    entry.owner_name && `Owner: ${entry.owner_name}`,
    entry.product && `Product: ${entry.product}`,
    entry.serial_no && `Serial No: ${entry.serial_no}`,
    entry.issuer && `Issuer: ${entry.issuer}`,
    entry.amount != null && `Amount: ${entry.amount}`,
    entry.date_of_issue && `Date of Issue: ${entry.date_of_issue}`,
    entry.date_of_maturity && `Date of Maturity: ${entry.date_of_maturity}`,
    entry.document_original_name && `Uploaded as: ${entry.document_original_name}`,
  ].filter(Boolean).join('\n');
}

// Names the uploaded document after its record and files it under Documents,
// so it can be matched to the record straight from Google Drive.
async function labelDocument(snapshot, entry) {
  if (!entry?.document_path) return;
  const docsId = await ensureFolderIn(snapshot.folderId, DOCUMENTS_FOLDER);
  const fileId = encodeURIComponent(entry.document_path);
  const current = await drive(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`);
  const parents = current.parents || [];
  const move = parents.includes(docsId)
    ? ''
    : `&addParents=${docsId}&removeParents=${parents.join(',')}`;
  const group = snapshot.data.groups.find((item) => Number(item.id) === Number(entry.group_id));
  await drive(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id${move}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: documentName(entry),
      description: documentDescription(entry, group?.name),
      appProperties: { financeEntryId: String(entry.id) },
    }),
  });
}

async function labelDocumentSafely(snapshot, entry) {
  try {
    await labelDocument(snapshot, entry);
    return true;
  } catch (error) {
    console.error(`Could not label the document for record #${entry.id}:`, error.message);
    // A file that no longer exists cannot be labelled; do not keep retrying it.
    return error.driveStatus === 404 || error.driveStatus === 403;
  }
}

// One-time pass for documents uploaded before files were named after their
// record. Progress is kept per record and each request spends at most a few
// seconds on it, so a slow or missing file never holds up loading the list.
async function labelExistingDocuments(snapshot) {
  const { data } = snapshot;
  if (data.documentsLabeled || !snapshot.dataFileId) return;
  const done = new Set((data.labelledEntries || []).map(Number));
  const started = Date.now();
  let progress = false;
  let remaining = false;
  for (const entry of data.entries) {
    if (!entry.document_path || done.has(Number(entry.id))) continue;
    if (Date.now() - started > LABEL_BUDGET_MS) {
      remaining = true;
      break;
    }
    if (await labelDocumentSafely(snapshot, entry)) {
      done.add(Number(entry.id));
      progress = true;
    } else {
      remaining = true;
    }
  }
  if (!progress && remaining) return;
  if (remaining) {
    data.labelledEntries = [...done];
  } else {
    data.documentsLabeled = true;
    delete data.labelledEntries;
  }
  try {
    await saveData(snapshot);
  } catch (error) {
    console.error('Could not record the document labelling progress:', error.message);
  }
}

// A create sent again (after a timeout, or from the offline queue) returns the
// record made the first time instead of adding a duplicate.
function findRepeat(data, kind, opId) {
  if (!opId) return null;
  const seen = (data.recentOps || []).find((op) => op.id === opId && op.kind === kind);
  if (!seen) return null;
  const list = { group: data.groups, entry: data.entries, note: data.notes }[kind];
  return list.find((row) => Number(row.id) === Number(seen.recordId)) || null;
}

function rememberOp(data, kind, opId, recordId) {
  if (!opId) return;
  data.recentOps = [...(data.recentOps || []), { id: String(opId), kind, recordId }].slice(-RECENT_OPS_LIMIT);
}

let lastBackupDay = '';

async function ensureFolderIn(parentId, name) {
  const query = encodeURIComponent(`name='${name}' and mimeType='${FOLDER_MIME}' and '${parentId}' in parents and trashed=false`);
  const listed = await drive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`);
  if (listed.files?.[0]?.id) return listed.files[0].id;
  const created = await drive('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return created.id;
}

// Keeps a copy of the records as they were before the first change of each day.
async function backupBeforeSave(snapshot) {
  const day = new Date().toISOString().slice(0, 10);
  if (!snapshot.dataFileId || lastBackupDay === day) return;
  const backupsId = await ensureFolderIn(snapshot.folderId, BACKUP_FOLDER);
  const name = `finance-data-${day}.json`;
  const query = encodeURIComponent(`name='${name}' and '${backupsId}' in parents and trashed=false`);
  const listed = await drive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`);
  if (!listed.files?.length) {
    await drive(`https://www.googleapis.com/drive/v3/files/${snapshot.dataFileId}/copy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, parents: [backupsId] }),
    });
  }
  lastBackupDay = day;
}

function cellValue(type, value) {
  if (value === null || value === undefined || value === '') return null;
  if (type === 'money' || type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : String(value);
  }
  if (type === 'date') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
    return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : String(value);
  }
  if (type === 'link') return value;
  return String(value);
}

function displayLength(value) {
  if (value instanceof Date) return 10;
  if (value && typeof value === 'object') return String(value.text).length;
  if (typeof value === 'number') return value.toLocaleString('en-US', { maximumFractionDigits: 2 }).length + 3;
  return String(value ?? '').length;
}

// One formatted workbook is used for both the .xlsx file and the Google Sheet,
// so the orange header, borders, widths and frozen header survive every save.
async function recordsWorkbook(data) {
  const ExcelJS = require('exceljs');
  const groups = new Map(data.groups.map((group) => [Number(group.id), group.name]));
  const entries = [...data.entries].sort((a, b) => (
    String(groups.get(Number(a.group_id)) || '').localeCompare(String(groups.get(Number(b.group_id)) || ''))
    || String(a.date_of_maturity).localeCompare(String(b.date_of_maturity))
  ));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Finance Tracker';
  const sheet = workbook.addWorksheet('Records', { views: [{ state: 'frozen', ySplit: 1 }] });
  const border = {
    top: { style: 'thin', color: { argb: BORDER_COLOR } },
    left: { style: 'thin', color: { argb: BORDER_COLOR } },
    bottom: { style: 'thin', color: { argb: BORDER_COLOR } },
    right: { style: 'thin', color: { argb: BORDER_COLOR } },
  };

  const header = sheet.addRow(SHEET_COLUMNS.map((column) => column.title));
  header.height = 20;
  header.eachCell((cell) => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: 'middle' };
    cell.border = border;
  });

  const widths = SHEET_COLUMNS.map((column) => column.title.length);
  for (const entry of entries) {
    const values = SHEET_COLUMNS.map((column) => cellValue(column.type, column.pick(entry, groups)));
    const row = sheet.addRow(values);
    SHEET_COLUMNS.forEach((column, index) => {
      const cell = row.getCell(index + 1);
      cell.border = border;
      cell.alignment = { vertical: 'middle' };
      if (column.type === 'money') cell.numFmt = '#,##0.00';
      if (column.type === 'number') cell.numFmt = '0.00';
      if (column.type === 'date') cell.numFmt = 'yyyy-mm-dd';
      if (column.type === 'text') cell.numFmt = '@';
      if (column.type === 'link' && values[index]) cell.font = { color: { argb: 'FF1155CC' }, underline: true };
      widths[index] = Math.max(widths[index], displayLength(values[index]));
    });
  }

  SHEET_COLUMNS.forEach((column, index) => {
    sheet.getColumn(index + 1).width = Math.min(Math.max(widths[index] + 3, 10), 48);
  });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: SHEET_COLUMNS.length } };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function findOrCreate(snapshot, name, mimeType) {
  const query = encodeURIComponent(`name='${name}' and mimeType='${mimeType}' and '${snapshot.folderId}' in parents and trashed=false`);
  const listed = await drive(`https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id)&pageSize=1`);
  if (listed.files?.[0]?.id) return listed.files[0].id;
  const created = await drive('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, parents: [snapshot.folderId], mimeType }),
  });
  return created.id;
}

async function uploadWorkbook(fileId, workbook) {
  await drive(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'content-type': EXCEL_MIME },
    body: workbook,
  });
}

// Rewrites the Finance Records Google Sheet and the Finance Records.xlsx file
// from the records. Either can fail without affecting the other or the save.
async function saveRecordsSheet(snapshot) {
  const workbook = await recordsWorkbook(snapshot.data);
  try {
    sheetId = sheetId || await findOrCreate(snapshot, SHEET_NAME, SHEET_MIME);
    await uploadWorkbook(sheetId, workbook);
  } catch (error) {
    sheetId = '';
    console.error('Could not update the Finance Records sheet:', error.message);
  }
  try {
    excelId = excelId || await findOrCreate(snapshot, EXCEL_NAME, EXCEL_MIME);
    await uploadWorkbook(excelId, workbook);
  } catch (error) {
    excelId = '';
    console.error('Could not update the Finance Records Excel file:', error.message);
  }
}

async function saveData(snapshot) {
  try {
    await writeData(snapshot);
  } catch (error) {
    // The change was made on the cached copy; drop it so it is not saved later by accident.
    cache = null;
    throw error;
  }
  try {
    await saveRecordsSheet(snapshot);
  } catch (error) {
    sheetId = '';
    console.error('Could not update the Finance Records sheet:', error.message);
  }
}

async function writeData(snapshot) {
  const body = JSON.stringify(snapshot.data, null, 2);
  if (snapshot.dataFileId) {
    if (await fileVersion(snapshot.dataFileId) !== snapshot.version) {
      throw stale();
    }
    try {
      await backupBeforeSave(snapshot);
    } catch (error) {
      console.error('Could not back up the records before saving:', error.message);
    }
  } else {
    // Another instance may have created the file since this one looked.
    if (await findDataFile(snapshot.folderId)) {
      throw stale();
    }
    const created = await drive('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: DATA_NAME,
        parents: [snapshot.folderId],
        mimeType: 'application/json',
      }),
    });
    snapshot.dataFileId = created.id;
    await googleAuth.rememberDriveIds(snapshot.folderId, snapshot.dataFileId);
  }
  // Not repeated blindly: another instance may save in between, so a failed
  // write re-runs the whole change on freshly loaded records instead.
  let saved;
  try {
    saved = await drive(`https://www.googleapis.com/upload/drive/v3/files/${snapshot.dataFileId}?uploadType=media&fields=version`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body,
      once: true,
    });
  } catch (error) {
    if (error.status === 503) error.stale = true;
    throw error;
  }
  snapshot.version = String(saved.version);
}

function nextId(data, name) {
  data.counters[name] = Number(data.counters[name] || 0) + 1;
  return data.counters[name];
}

async function uploadBuffer(buffer, name, mimeType) {
  const snapshot = await loadData();
  const created = await drive('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: name || 'document', parents: [snapshot.folderId] }),
  });
  await drive(`https://www.googleapis.com/upload/drive/v3/files/${created.id}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'content-type': mimeType || 'application/octet-stream' },
    body: buffer,
    timeout: UPLOAD_TIMEOUT_MS,
  });
  return created.id;
}

const store = {
  driver: 'google-drive',

  async listGroups() {
    return locked(async () => {
      const { data } = await loadData();
      return [...data.groups].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    });
  },

  async getGroup(id) {
    return locked(async () => {
      const { data } = await loadData();
      return data.groups.find((group) => Number(group.id) === Number(id)) || null;
    });
  },

  async createGroup(name, opId) {
    return locked(async () => {
      const snapshot = await loadData();
      const repeat = findRepeat(snapshot.data, 'group', opId);
      if (repeat) return repeat;
      if (snapshot.data.groups.some((group) => group.name === name)) throw conflict('A group with that name already exists');
      const stamp = nowStamp();
      const created = { id: nextId(snapshot.data, 'groups'), name, created_at: stamp, updated_at: stamp };
      snapshot.data.groups.push(created);
      rememberOp(snapshot.data, 'group', opId, created.id);
      await saveData(snapshot);
      return created;
    });
  },

  async updateGroup(id, name) {
    return locked(async () => {
      const snapshot = await loadData();
      const group = snapshot.data.groups.find((item) => Number(item.id) === Number(id));
      if (!group) return null;
      if (snapshot.data.groups.some((item) => item.name === name && Number(item.id) !== Number(id))) {
        throw conflict('A group with that name already exists');
      }
      group.name = name;
      group.updated_at = nowStamp();
      await saveData(snapshot);
      for (const entry of snapshot.data.entries) {
        if (Number(entry.group_id) === Number(id)) await labelDocumentSafely(snapshot, entry);
      }
      return group;
    });
  },

  async deleteGroup(id) {
    return locked(async () => {
      const snapshot = await loadData();
      snapshot.data.groups = snapshot.data.groups.filter((group) => Number(group.id) !== Number(id));
      for (const entry of snapshot.data.entries) {
        if (Number(entry.group_id) === Number(id)) entry.group_id = null;
      }
      await saveData(snapshot);
    });
  },

  async listEntries() {
    return locked(async () => {
      const snapshot = await loadData();
      await labelExistingDocuments(snapshot);
      const { data } = snapshot;
      return [...data.entries].sort((a, b) => String(a.date_of_maturity).localeCompare(String(b.date_of_maturity)));
    });
  },

  async getEntry(id) {
    return locked(async () => {
      const { data } = await loadData();
      return data.entries.find((entry) => Number(entry.id) === Number(id)) || null;
    });
  },

  async createEntry(row, opId) {
    return locked(async () => {
      const snapshot = await loadData();
      const repeat = findRepeat(snapshot.data, 'entry', opId);
      if (repeat) return repeat;
      const stamp = nowStamp();
      const created = { ...row, id: nextId(snapshot.data, 'entries'), created_at: stamp, updated_at: stamp };
      snapshot.data.entries.push(created);
      rememberOp(snapshot.data, 'entry', opId, created.id);
      await saveData(snapshot);
      await labelDocumentSafely(snapshot, created);
      return created;
    });
  },

  async updateEntry(id, row) {
    return locked(async () => {
      const snapshot = await loadData();
      const index = snapshot.data.entries.findIndex((entry) => Number(entry.id) === Number(id));
      if (index < 0) return null;
      const current = snapshot.data.entries[index];
      const updated = { ...current, ...row, id: current.id, created_at: current.created_at, updated_at: nowStamp() };
      snapshot.data.entries[index] = updated;
      await saveData(snapshot);
      await labelDocumentSafely(snapshot, updated);
      return updated;
    });
  },

  async deleteEntry(id) {
    return locked(async () => {
      const snapshot = await loadData();
      snapshot.data.entries = snapshot.data.entries.filter((entry) => Number(entry.id) !== Number(id));
      for (const note of snapshot.data.notes) {
        if (Number(note.entry_id) === Number(id)) note.entry_id = null;
      }
      await saveData(snapshot);
    });
  },

  async listNotes() {
    return locked(async () => {
      const { data } = await loadData();
      return [...data.notes].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    });
  },

  async getNote(id) {
    return locked(async () => {
      const { data } = await loadData();
      return data.notes.find((note) => Number(note.id) === Number(id)) || null;
    });
  },

  async createNote(row, opId) {
    return locked(async () => {
      const snapshot = await loadData();
      const repeat = findRepeat(snapshot.data, 'note', opId);
      if (repeat) return repeat;
      const stamp = nowStamp();
      const created = {
        id: nextId(snapshot.data, 'notes'),
        title: row.title,
        content: row.content,
        entry_id: row.entry_id,
        created_at: stamp,
        updated_at: stamp,
      };
      snapshot.data.notes.push(created);
      rememberOp(snapshot.data, 'note', opId, created.id);
      await saveData(snapshot);
      return created;
    });
  },

  async updateNote(id, row) {
    return locked(async () => {
      const snapshot = await loadData();
      const note = snapshot.data.notes.find((item) => Number(item.id) === Number(id));
      if (!note) return null;
      note.title = row.title;
      note.content = row.content;
      note.entry_id = row.entry_id;
      note.updated_at = nowStamp();
      await saveData(snapshot);
      return note;
    });
  },

  async deleteNote(id) {
    return locked(async () => {
      const snapshot = await loadData();
      snapshot.data.notes = snapshot.data.notes.filter((note) => Number(note.id) !== Number(id));
      await saveData(snapshot);
    });
  },

  async saveFile(file) {
    return locked(async () => uploadBuffer(file.buffer, file.originalname, file.mimetype));
  },

  async removeFile(storedPath) {
    if (!storedPath || storedPath.includes('/') || storedPath.includes('\\')) return;
    await drive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(storedPath)}`, { method: 'DELETE' }).catch(() => {});
  },

  async openFile(storedPath) {
    if (!storedPath) return null;
    const response = await drive(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(storedPath)}?alt=media`, { raw: true });
    if (!response.ok) return null;
    const { Readable } = require('node:stream');
    return { stream: Readable.fromWeb(response.body) };
  },

  async importLocalSnapshot() {
    return locked(async () => {
      const snapshot = await loadData();
      if (snapshot.dataFileId) return false;
      const sqlite = require('./sqliteStore');
      const groups = await sqlite.listGroups();
      const entries = await sqlite.listEntries();
      const notes = await sqlite.listNotes();
      for (const entry of entries) {
        if (!entry.document_path) continue;
        const opened = await sqlite.openFile(entry.document_path);
        if (!opened?.filePath) {
          entry.document_path = null;
          continue;
        }
        const buffer = await fs.promises.readFile(opened.filePath);
        const ext = path.extname(opened.filePath).toLowerCase();
        const mime = {
          '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
          '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
        }[ext] || 'application/octet-stream';
        entry.document_path = await uploadBuffer(buffer, entry.document_original_name || path.basename(opened.filePath), mime);
      }
      const maxId = (rows) => rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
      snapshot.data = {
        groups,
        entries,
        notes,
        counters: { groups: maxId(groups), entries: maxId(entries), notes: maxId(notes) },
      };
      await saveData(snapshot);
      cache = snapshot;
      return true;
    });
  },
};

module.exports = store;
