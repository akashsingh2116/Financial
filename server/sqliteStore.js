const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { DATA_DIR } = require('./paths');

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');

function conflict(err) {
  if (String(err.message).includes('UNIQUE')) {
    const error = new Error('A group with that name already exists');
    error.status = 409;
    throw error;
  }
  throw err;
}

module.exports = {
  driver: 'sqlite',

  async listGroups() {
    return db.prepare('SELECT * FROM groups ORDER BY name COLLATE NOCASE').all();
  },

  async getGroup(id) {
    return db.prepare('SELECT * FROM groups WHERE id = ?').get(id) || null;
  },

  async createGroup(name) {
    try {
      const result = db.prepare('INSERT INTO groups (name) VALUES (?)').run(name);
      return db.prepare('SELECT * FROM groups WHERE id = ?').get(result.lastInsertRowid);
    } catch (err) {
      conflict(err);
    }
  },

  async updateGroup(id, name) {
    try {
      db.prepare("UPDATE groups SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name, id);
    } catch (err) {
      conflict(err);
    }
    return db.prepare('SELECT * FROM groups WHERE id = ?').get(id);
  },

  async deleteGroup(id) {
    db.prepare('UPDATE entries SET group_id = NULL WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM groups WHERE id = ?').run(id);
  },

  async listEntries() {
    return db.prepare('SELECT * FROM entries ORDER BY date_of_maturity ASC').all();
  },

  async getEntry(id) {
    return db.prepare('SELECT * FROM entries WHERE id = ?').get(id) || null;
  },

  async createEntry(row) {
    const result = db.prepare(`
      INSERT INTO entries (
        serial_no, owner_name, product, issuer, amount, interest_rate, maturity_amount,
        date_of_issue, date_of_maturity, nominee_name, nominee_relation,
        premium_frequency, status, group_id, remarks, document_path, document_original_name
      ) VALUES (
        @serial_no, @owner_name, @product, @issuer, @amount, @interest_rate, @maturity_amount,
        @date_of_issue, @date_of_maturity, @nominee_name, @nominee_relation,
        @premium_frequency, @status, @group_id, @remarks, @document_path, @document_original_name
      )
    `).run(row);
    return db.prepare('SELECT * FROM entries WHERE id = ?').get(result.lastInsertRowid);
  },

  async updateEntry(id, row) {
    db.prepare(`
      UPDATE entries SET
        serial_no = @serial_no, owner_name = @owner_name, product = @product,
        issuer = @issuer, amount = @amount, interest_rate = @interest_rate,
        maturity_amount = @maturity_amount,
        date_of_issue = @date_of_issue, date_of_maturity = @date_of_maturity,
        nominee_name = @nominee_name, nominee_relation = @nominee_relation,
        premium_frequency = @premium_frequency, status = @status, group_id = @group_id, remarks = @remarks,
        document_path = @document_path, document_original_name = @document_original_name,
        updated_at = datetime('now')
      WHERE id = @id
    `).run({ ...row, id });
    return db.prepare('SELECT * FROM entries WHERE id = ?').get(id);
  },

  async deleteEntry(id) {
    db.prepare('DELETE FROM entries WHERE id = ?').run(id);
  },

  async listNotes() {
    return db.prepare('SELECT * FROM notes ORDER BY updated_at DESC').all();
  },

  async getNote(id) {
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(id) || null;
  },

  async createNote(row) {
    const result = db.prepare(
      'INSERT INTO notes (title, content, entry_id) VALUES (?, ?, ?)'
    ).run(row.title, row.content, row.entry_id);
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(result.lastInsertRowid);
  },

  async updateNote(id, row) {
    db.prepare(
      "UPDATE notes SET title = ?, content = ?, entry_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(row.title, row.content, row.entry_id, id);
    return db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
  },

  async deleteNote(id) {
    db.prepare('DELETE FROM notes WHERE id = ?').run(id);
  },

  async saveFile(file) {
    if (file.filename && !file.buffer) return file.filename;
    const ext = path.extname(file.originalname || '');
    const filename = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    await fs.promises.writeFile(path.join(UPLOAD_DIR, filename), file.buffer);
    return filename;
  },

  async removeFile(storedPath) {
    if (!storedPath) return;
    const filePath = path.join(UPLOAD_DIR, path.basename(storedPath));
    await fs.promises.rm(filePath, { force: true });
  },

  async openFile(storedPath) {
    if (!storedPath) return null;
    const filePath = path.join(UPLOAD_DIR, path.basename(storedPath));
    if (!fs.existsSync(filePath)) return null;
    return { filePath };
  },
};
