import { useEffect, useMemo, useState } from 'react';
import EntryFormModal from './EntryFormModal';
import EntryDetailModal from './EntryDetailModal';
import { createEntry, updateEntry, deleteEntry } from '../api';
import { STATUS_OPTIONS } from '../constants';
import { daysUntil, formatMoney } from '../format';
import {
  entryKey,
  exportCsv,
  exportExcel,
  exportPdf,
  exportWord,
  recordsFromFile,
  toFormData,
} from '../transfer';

export default function EntriesTab({ entries, notes, reload }) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [modalEntry, setModalEntry] = useState(undefined); // undefined = closed, null = new, object = edit
  const [viewEntry, setViewEntry] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [transferMessage, setTransferMessage] = useState('');
  const [transferError, setTransferError] = useState('');

  useEffect(() => {
    if (!exportOpen) return undefined;
    function close() { setExportOpen(false); }
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [exportOpen]);

  const owners = useMemo(
    () => [...new Set(entries.map((e) => e.owner_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [entries],
  );
  const products = useMemo(
    () => [...new Set(entries.map((e) => e.product).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [entries],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (productFilter !== 'all' && e.product !== productFilter) return false;
      if (ownerFilter !== 'all' && e.owner_name !== ownerFilter) return false;
      if (!q) return true;
      return [e.serial_no, e.owner_name, e.product, e.nominee_name, e.issuer, e.remarks]
        .some((value) => value?.toLowerCase().includes(q));
    });
  }, [entries, query, statusFilter, productFilter, ownerFilter]);

  const linkedNotes = useMemo(
    () => (viewEntry ? notes.filter((note) => note.entry_id === viewEntry.id) : []),
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
      if (kind === 'excel') exportExcel(filtered);
      else if (kind === 'word') await exportWord(filtered);
      else if (kind === 'pdf') exportPdf(filtered);
      else exportCsv(filtered);
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
      let added = 0;
      let skipped = 0;
      for (const record of records) {
        const key = entryKey(record);
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }
        await createEntry(toFormData(record));
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
          <table>
            <thead>
              <tr>
                <th>Serial No</th>
                <th>Owner</th>
                <th>Product</th>
                <th>Amount</th>
                <th>Maturity Amt</th>
                <th>Issue Date</th>
                <th>Maturity Date</th>
                <th>Nominee</th>
                <th>Status</th>
                <th>Doc</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const days = daysUntil(e.date_of_maturity);
                const soon = e.status === 'active' && days >= 0 && days <= 90;
                const overdue = e.status === 'active' && days < 0;
                return (
                  <tr key={e.id} className={overdue ? 'row-overdue' : soon ? 'row-soon' : ''}>
                    <td>
                      <button className="link-btn" onClick={() => setViewEntry(e)}>{e.serial_no}</button>
                    </td>
                    <td>{e.owner_name}</td>
                    <td>{e.product}</td>
                    <td>₹{formatMoney(e.amount)}</td>
                    <td>₹{formatMoney(e.maturity_amount)}</td>
                    <td>{e.date_of_issue}</td>
                    <td>
                      {e.date_of_maturity}
                      {soon && <span className="badge badge-warn">{days}d left</span>}
                      {overdue && <span className="badge badge-danger">overdue</span>}
                    </td>
                    <td>{e.nominee_name}</td>
                    <td><span className={`badge status-${e.status}`}>{e.status}</span></td>
                    <td>{e.document_path ? '📎' : <span className="muted">—</span>}</td>
                    <td className="actions-cell">
                      <button className="link-btn" onClick={() => setViewEntry(e)}>View</button>
                      <button className="link-btn" onClick={() => setModalEntry(e)}>Edit</button>
                      <button className="link-btn danger" onClick={() => setDeleteTarget(e)}>Delete</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewEntry && (
        <EntryDetailModal
          entry={viewEntry}
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
