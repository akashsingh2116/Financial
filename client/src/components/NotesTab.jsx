import { useState } from 'react';
import { createNote, updateNote, deleteNote } from '../api';
import { formatDateTime } from '../format';

export default function NotesTab({ notes, entries, reload }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [entryId, setEntryId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  function resetForm() {
    setTitle('');
    setContent('');
    setEntryId('');
    setEditingId(null);
    setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!content.trim()) {
      setError('Note content is required');
      return;
    }
    setSaving(true);
    setError('');
    const payload = { title: title.trim() || null, content: content.trim(), entry_id: entryId || null };
    try {
      if (editingId) {
        await updateNote(editingId, payload);
      } else {
        await createNote(payload);
      }
      resetForm();
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function startEdit(note) {
    setEditingId(note.id);
    setTitle(note.title || '');
    setContent(note.content);
    setEntryId(note.entry_id ? String(note.entry_id) : '');
    setError('');
  }

  async function handleDelete() {
    await deleteNote(deleteTarget.id);
    setDeleteTarget(null);
    if (editingId === deleteTarget.id) resetForm();
    await reload();
  }

  function linkedEntry(note) {
    if (!note.entry_id) return null;
    return entries.find((e) => String(e.id) === String(note.entry_id));
  }

  return (
    <div className="tab-panel">
      <form className="note-form" onSubmit={handleSubmit}>
        <input
          placeholder="Title (optional)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          rows={3}
          placeholder="Write a note... e.g. reminders, follow-ups, agent contact details, claim process steps"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <div className="note-form-row">
          <select value={entryId} onChange={(e) => setEntryId(e.target.value)}>
            <option value="">Not linked to an entry</option>
            {entries.map((e) => (
              <option key={e.id} value={e.id}>{e.serial_no} — {e.owner_name}</option>
            ))}
          </select>
          <div className="note-form-actions">
            {editingId && <button type="button" className="btn btn-ghost" onClick={resetForm}>Cancel edit</button>}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Update Note' : '+ Add Note'}
            </button>
          </div>
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>

      {notes.length === 0 ? (
        <div className="empty-state">No notes yet. Add one above.</div>
      ) : (
        <div className="notes-grid">
          {notes.map((note) => {
            const linked = linkedEntry(note);
            return (
              <div className="note-card" key={note.id}>
                {note.title && <h4>{note.title}</h4>}
                <p className="note-content">{note.content}</p>
                {linked && <div className="note-link">🔗 {linked.serial_no} — {linked.owner_name}</div>}
                {note.pending && <div className="muted">Waiting to sync</div>}
                <div className="note-footer">
                  <span className="muted">{formatDateTime(note.updated_at)}</span>
                  <div className="note-actions">
                    <button className="link-btn" onClick={() => startEdit(note)}>Edit</button>
                    <button className="link-btn danger" onClick={() => setDeleteTarget(note)}>Delete</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {deleteTarget && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className="modal modal-sm">
            <h3>Delete note?</h3>
            <p>This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
