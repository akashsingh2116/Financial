import { useMemo, useState } from 'react';
import EntryFormModal from './EntryFormModal';
import { createEntry, createGroup, deleteGroup, updateEntry, updateGroup } from '../api';
import { daysUntil, formatDate, formatMoney } from '../format';

const PAGE_SIZE = 50;

export default function GroupsTab({ groups, entries, reload }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [modalEntry, setModalEntry] = useState(undefined);
  const [presetGroupId, setPresetGroupId] = useState('');

  const cards = useMemo(() => groups.map((group) => {
    const rows = entries.filter((entry) => String(entry.group_id) === String(group.id));
    const active = rows.filter((entry) => entry.status === 'active');
    return {
      group,
      rows,
      count: rows.length,
      invested: active.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
      maturity: active.reduce((sum, entry) => sum + Number(entry.maturity_amount || 0), 0),
    };
  }), [groups, entries]);

  const openCard = cards.find((card) => String(card.group.id) === String(openId)) || null;
  const pageCount = openCard ? Math.max(1, Math.ceil(openCard.rows.length / PAGE_SIZE)) : 1;
  const safePage = Math.min(page, pageCount);
  const visibleRows = openCard
    ? openCard.rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
    : [];
  const ungrouped = entries.filter((entry) => !entry.group_id).length;

  async function handleCreate(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Group name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await createGroup(trimmed);
      setName('');
      await reload();
    } catch (err) {
      setError(err.message || 'Could not create the group');
    } finally {
      setSaving(false);
    }
  }

  async function handleRename(event) {
    event.preventDefault();
    const trimmed = editName.trim();
    if (!trimmed) {
      setError('Group name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await updateGroup(editingId, trimmed);
      setEditingId(null);
      await reload();
    } catch (err) {
      setError(err.message || 'Could not rename the group');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    setError('');
    try {
      await deleteGroup(deleteTarget.id);
      if (String(openId) === String(deleteTarget.id)) setOpenId(null);
      setDeleteTarget(null);
      await reload();
    } catch (err) {
      setError(err.message || 'Could not delete the group');
    } finally {
      setSaving(false);
    }
  }

  async function handleEntrySubmit(formData) {
    if (modalEntry) await updateEntry(modalEntry.id, formData);
    else await createEntry(formData);
    setModalEntry(undefined);
    await reload();
  }

  function openGroup(id) {
    setOpenId(String(openId) === String(id) ? null : id);
    setPage(1);
  }

  return (
    <div className="tab-panel">
      <form className="note-form" onSubmit={handleCreate}>
        <div className="note-form-row">
          <input
            placeholder="New group name, e.g. Family, Post Office, Tax saving"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
          />
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : '+ Add Group'}
          </button>
        </div>
        {error && <div className="form-error">{error}</div>}
      </form>
      <p className="toolbar-hint">
        {entries.length} entries across {groups.length} {groups.length === 1 ? 'group' : 'groups'}.
        {ungrouped > 0 ? ` ${ungrouped} ${ungrouped === 1 ? 'is' : 'are'} not in a group yet.` : ''}
        {' '}Lists show 50 entries at a time, so a group can hold well over 1,000 records.
      </p>

      {groups.length === 0 ? (
        <div className="empty-state">No groups yet. Create one, then add entries into it.</div>
      ) : (
        <div className="group-list">
          {cards.map(({ group, count, invested, maturity }) => (
            <section className="panel group-card" key={group.id}>
              <div className="group-card-head">
                <button type="button" className="link-btn group-name" onClick={() => openGroup(group.id)}>
                  {group.name}
                  {group.pending && <span className="badge badge-warn">Waiting to sync</span>}
                </button>
                <div className="note-actions">
                  <button type="button" className="link-btn" onClick={() => { setEditingId(group.id); setEditName(group.name); setError(''); }}>Rename</button>
                  <button type="button" className="link-btn danger" onClick={() => setDeleteTarget(group)}>Delete</button>
                </div>
              </div>
              <div className="group-metrics">
                <span>{count} {count === 1 ? 'entry' : 'entries'}</span>
                <span>Active invested ₹{formatMoney(invested)}</span>
                <span>Expected maturity ₹{formatMoney(maturity)}</span>
              </div>
              {String(openId) === String(group.id) && (
                <div className="group-body">
                  {editingId === group.id && (
                    <form className="note-form-row" onSubmit={handleRename}>
                      <input value={editName} onChange={(event) => setEditName(event.target.value)} maxLength={80} />
                      <button type="submit" className="btn btn-primary" disabled={saving}>Save</button>
                      <button type="button" className="btn btn-ghost" onClick={() => setEditingId(null)}>Cancel</button>
                    </form>
                  )}
                  <div className="group-body-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => { setPresetGroupId(group.id); setModalEntry(null); }}
                    >
                      + Add entry to {group.name}
                    </button>
                  </div>
                  {visibleRows.length === 0 ? (
                    <div className="muted">No entries in this group yet.</div>
                  ) : (
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Serial No</th>
                            <th>Owner</th>
                            <th>Product</th>
                            <th>Amount</th>
                            <th>Maturity Amount</th>
                            <th>Maturity Date</th>
                            <th>Status</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleRows.map((entry) => (
                            <tr key={entry.id}>
                              <td>{entry.serial_no}{entry.pending && <span className="badge badge-warn">Waiting to sync</span>}</td>
                              <td>{entry.owner_name}</td>
                              <td>{entry.product}</td>
                              <td>₹{formatMoney(entry.amount)}</td>
                              <td>₹{formatMoney(entry.maturity_amount)}</td>
                              <td className="nowrap"><MaturityDate entry={entry} /></td>
                              <td><span className={`badge status-${entry.status}`}>{entry.status}</span></td>
                              <td><button type="button" className="link-btn" onClick={() => setModalEntry(entry)}>Edit</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {openCard && openCard.rows.length > PAGE_SIZE && (
                    <div className="pager">
                      <button type="button" className="btn btn-ghost" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</button>
                      <span>{(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, openCard.rows.length)} of {openCard.rows.length}</span>
                      <button type="button" className="btn btn-ghost" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Next</button>
                    </div>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {modalEntry !== undefined && (
        <EntryFormModal
          entry={modalEntry}
          groups={groups}
          defaultGroupId={modalEntry ? '' : presetGroupId}
          onClose={() => setModalEntry(undefined)}
          onSubmit={handleEntrySubmit}
        />
      )}

      {deleteTarget && (
        <div className="modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeleteTarget(null); }}>
          <div className="modal modal-sm">
            <h3>Delete group?</h3>
            <p>
              <strong>{deleteTarget.name}</strong> will be removed. Its entries stay in the tracker and move to “No group”.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button type="button" className="btn btn-danger" disabled={saving} onClick={handleDelete}>
                {saving ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Maturity date with the same "days left" / "overdue" badges as the entries list.
function MaturityDate({ entry }) {
  const days = daysUntil(entry.date_of_maturity);
  const active = entry.status === 'active';
  return (
    <>
      {formatDate(entry.date_of_maturity)}
      {active && days >= 0 && days <= 90 && <span className="badge badge-warn">{days}d left</span>}
      {active && days < 0 && <span className="badge badge-danger">{Math.abs(days)}d overdue</span>}
    </>
  );
}
