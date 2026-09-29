import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import EntryFormModal from './EntryFormModal';
import EntryDetailModal from './EntryDetailModal';
import { createEntry, createGroup, updateEntry, deleteEntry } from '../api';
import { STATUS_OPTIONS } from '../constants';
import { daysUntil, formatDate, formatMoney } from '../format';
import {
  entryKey,
  exportCsv,
  exportExcel,
  exportPdf,
  exportWord,
  recordsFromFile,
  toFormData,
} from '../transfer';

const PAGE_SIZE = 50;

export default function EntriesTab({ entries, notes, groups = [], reload }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [modalEntry, setModalEntry] = useState(undefined); // undefined = closed, null = new, object = edit
  const [viewEntry, setViewEntry] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [actionMenu, setActionMenu] = useState(null);
  const [importing, setImporting] = useState(false);
  const [transferMessage, setTransferMessage] = useState('');
  const [transferError, setTransferError] = useState('');

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, productFilter, ownerFilter, groupFilter]);

  useEffect(() => {
    if (!exportOpen) return undefined;
    function close() { setExportOpen(false); }
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [exportOpen]);

  useEffect(() => {
    if (!actionMenu) return undefined;
    function close() { setActionMenu(null); }
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [actionMenu]);

  function toggleActionMenu(event, entry) {
    event.stopPropagation();
    if (actionMenu?.id === entry.id) {
      setActionMenu(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    // Sized to the compact menu below; it opens right under the button, or above it near the screen bottom.
    const menuHeight = 102;
    const menuWidth = 128;
    const openUp = window.innerHeight - rect.bottom < menuHeight + 8;
    setActionMenu({
      id: entry.id,
      entry,
      top: openUp ? rect.top - menuHeight - 4 : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
    });
  }

  const owners = useMemo(
    () => [...new Set(entries.map((e) => e.owner_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [entries],
  );
  const products = useMemo(
    () => [...new Set(entries.map((e) => e.product).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [entries],
  );

  function groupName(entry) {
    return groups.find((group) => String(group.id) === String(entry.group_id))?.name || '';
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (productFilter !== 'all' && e.product !== productFilter) return false;
      if (ownerFilter !== 'all' && e.owner_name !== ownerFilter) return false;
      if (groupFilter === 'none' && e.group_id) return false;
      if (groupFilter !== 'all' && groupFilter !== 'none' && String(e.group_id) !== String(groupFilter)) return false;
      if (!q) return true;
      const name = groups.find((group) => String(group.id) === String(e.group_id))?.name || '';
      return [e.serial_no, e.owner_name, e.product, e.nominee_name, e.issuer, e.remarks, name]
        .some((value) => value?.toLowerCase().includes(q));
    });
  }, [entries, groups, query, statusFilter, productFilter, ownerFilter, groupFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visible = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const linkedNotes = useMemo(
    () => (viewEntry ? notes.filter((note) => String(note.entry_id) === String(viewEntry.id)) : []),
    [notes, viewEntry],
  );

  async function handleSubmit(formData) {
    if (modalEntry) {
      await updateEntry(modalEntry.id, formData);
    } else {
      await createEntry(formData);
    }
    setModalEntry(undefined);
    await reload();
  }

  async function handleExport(kind) {
    setExportOpen(false);
    setTransferError('');
    setTransferMessage('');
    try {
      const named = filtered.map((entry) => ({ ...entry, group_name: groupName(entry) }));
      if (kind === 'excel') exportExcel(named);
      else if (kind === 'word') await exportWord(named);
      else if (kind === 'pdf') exportPdf(named);
      else exportCsv(named);
    } catch (err) {
      setTransferError(err.message || 'Export failed');
    }
  }

  async function handleImport(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    setTransferError('');
    setTransferMessage('');
    try {
      const { records, errors } = await recordsFromFile(file);
      if (!records.length) {
        const preview = errors.slice(0, 3).join(' ');
        const extra = errors.length > 3 ? ` (+${errors.length - 3} more)` : '';
        setTransferError((preview + extra) || 'No entries found in that file.');
        return;
      }

      const seen = new Set(entries.map(entryKey));
      const knownGroups = [...groups];
      let added = 0;
      let skipped = 0;
      for (const record of records) {
        const key = entryKey(record);
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }
        const formData = toFormData(record);
        const groupNameValue = String(record.group_name || '').trim();
        if (groupNameValue) {
          let group = knownGroups.find((item) => item.name.toLowerCase() === groupNameValue.toLowerCase());
          if (!group) {
            group = await createGroup(groupNameValue);
            knownGroups.push(group);
          }
          formData.set('group_id', String(group.id));
        }
        await createEntry(formData);
        seen.add(key);
        added += 1;
      }
      await reload();

      const parts = [`Imported ${added} ${added === 1 ? 'entry' : 'entries'}.`];
      if (skipped) parts.push(`${skipped} already existed and were skipped.`);
      if (errors.length) parts.push(`${errors.length} ${errors.length === 1 ? 'row was' : 'rows were'} skipped: ${errors.slice(0, 3).join(' ')}`);
      setTransferMessage(parts.join(' '));
    } catch (err) {
      setTransferError(err.message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await deleteEntry(deleteTarget.id);
      setDeleteTarget(null);
      if (viewEntry?.id === deleteTarget.id) setViewEntry(null);
      await reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tab-panel">
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="Search by serial no, owner, product, nominee, remarks..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
          <option value="all">All owners</option>
          {owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}
        </select>
        <select value={productFilter} onChange={(e) => setProductFilter(e.target.value)}>
          <option value="all">All products</option>
          {products.map((product) => <option key={product} value={product}>{product}</option>)}
        </select>
        <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
          <option value="all">All groups</option>
          <option value="none">No group</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">All statuses</option>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
        </select>
        <div className="menu" onClick={(event) => event.stopPropagation()}>
          <button
            className="btn btn-ghost"
            disabled={filtered.length === 0}
            onClick={() => setExportOpen((open) => !open)}
          >
            Export
          </button>
          {exportOpen && (
            <div className="menu-panel">
              <button className="menu-item" onClick={() => handleExport('excel')}>Excel (.xlsx)</button>
              <button className="menu-item" onClick={() => handleExport('word')}>Word (.docx)</button>
              <button className="menu-item" onClick={() => handleExport('pdf')}>PDF (.pdf)</button>
              <button className="menu-item" onClick={() => handleExport('csv')}>CSV (.csv)</button>
            </div>
          )}
        </div>
        <label className={`btn btn-ghost import-btn${importing ? ' is-disabled' : ''}`}>
          {importing ? 'Importing...' : 'Import'}
          <input
            type="file"
            accept=".xlsx,.xls,.csv,.docx,.pdf"
            onChange={handleImport}
            disabled={importing}
          />
        </label>
        <button className="btn btn-primary" onClick={() => setModalEntry(null)}>+ Add Entry</button>
      </div>
      <p className="toolbar-hint">
        Export downloads the entries currently shown. Import Excel, Word, PDF, or CSV from this app and adds them as new entries. Attached documents are not included.
      </p>
      {transferError && <div className="banner banner-error">{transferError}</div>}
      {transferMessage && <div className="banner banner-ok">{transferMessage}</div>}

      {filtered.length === 0 ? (
        <div className="empty-state">
          {entries.length === 0 ? 'No entries yet. Click "Add Entry" to get started.' : 'No entries match your search.'}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="entry-table">
            <thead>
              <tr>
                <th>Entry</th>
                <th>Product</th>
                <th className="num">Invested</th>
                <th className="num">Maturity</th>
                <th>Term</th>
                <th>Status</th>
                <th className="actions-head">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => {
                const days = daysUntil(e.date_of_maturity);
                const soon = e.status === 'active' && days >= 0 && days <= 90;
                const overdue = e.status === 'active' && days < 0;
                return (
                  <tr key={e.id} className={overdue ? 'row-overdue' : soon ? 'row-soon' : ''}>
                    <td>
                      <div className="cell-title">
                        <button className="link-btn" onClick={() => setViewEntry(e)}>{e.serial_no}</button>
                        {e.pending && <span className="badge badge-warn">Sync</span>}
                        {e.document_path && <span className="badge badge-doc">Doc</span>}
                      </div>
                      <div className="cell-sub"><span className="cell-label">Owner</span> {e.owner_name}</div>
                      {e.nominee_name && <div className="cell-sub"><span className="cell-label">Nominee</span> {e.nominee_name}</div>}
                    </td>
                    <td>
                      <div className="cell-title">{e.product}</div>
                      <div className="cell-sub"><span className="cell-label">Group</span> {groupName(e) || 'None'}</div>
                    </td>
                    <td className="num">₹{formatMoney(e.amount)}</td>
                    <td className="num">₹{formatMoney(e.maturity_amount)}</td>
                    <td>
                      <div className="cell-title">{formatDate(e.date_of_issue)}</div>
                      <div className="cell-sub">
                        to {formatDate(e.date_of_maturity)}
                        {soon && <span className="badge badge-warn">{days}d left</span>}
                        {overdue && <span className="badge badge-danger">{Math.abs(days)}d overdue</span>}
                      </div>
                    </td>
                    <td><span className={`badge status-${e.status}`}>{e.status}</span></td>
                    <td className="actions-cell">
                      <button type="button" className="btn btn-ghost action-btn" onClick={(event) => toggleActionMenu(event, e)}>
                        Actions
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {actionMenu && createPortal(
        <div
          className="menu-panel menu-panel-fixed"
          style={{ top: actionMenu.top, left: actionMenu.left }}
          onClick={(event) => event.stopPropagation()}
        >
          <button type="button" className="menu-item" onClick={() => { setViewEntry(actionMenu.entry); setActionMenu(null); }}>View</button>
          <button type="button" className="menu-item" onClick={() => { setModalEntry(actionMenu.entry); setActionMenu(null); }}>Edit</button>
          <button type="button" className="menu-item menu-item-danger" onClick={() => { setDeleteTarget(actionMenu.entry); setActionMenu(null); }}>Delete</button>
        </div>,
        // Rendered on the page body so animated parents cannot shift where it appears.
        document.body,
      )}
      {filtered.length > PAGE_SIZE && (
        <div className="pager">
          <button type="button" className="btn btn-ghost" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>Previous</button>
          <span>{(safePage - 1) * PAGE_SIZE + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}</span>
          <button type="button" className="btn btn-ghost" disabled={safePage >= pageCount} onClick={() => setPage(safePage + 1)}>Next</button>
        </div>
      )}

      {viewEntry && (
        <EntryDetailModal
          entry={{ ...viewEntry, group_name: groupName(viewEntry) }}
          notes={linkedNotes}
          onClose={() => setViewEntry(null)}
          onEdit={() => {
            setModalEntry(viewEntry);
            setViewEntry(null);
          }}
        />
      )}

      {modalEntry !== undefined && (
        <EntryFormModal
          entry={modalEntry}
          groups={groups}
          onClose={() => setModalEntry(undefined)}
          onSubmit={handleSubmit}
        />
      )}

      {deleteTarget && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className="modal modal-sm">
            <h3>Delete entry?</h3>
            <p>This will permanently delete <strong>{deleteTarget.serial_no}</strong> ({deleteTarget.owner_name}) and its attached document.</p>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setDeleteTarget(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={busy} onClick={handleDelete}>
                {busy ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
