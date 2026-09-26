import { useState } from 'react';
import { openDocument } from '../api';
import { daysUntil, formatDateTime, formatMoney } from '../format';

export default function EntryDetailModal({ entry, notes, onClose, onEdit }) {
  const [docError, setDocError] = useState('');
  const [opening, setOpening] = useState(false);

  const days = daysUntil(entry.date_of_maturity);
  const gain = Number(entry.maturity_amount || 0) - Number(entry.amount || 0);
  const active = entry.status === 'active';

  async function handleOpenDocument() {
    setDocError('');
    setOpening(true);
    try {
      await openDocument(entry.id);
    } catch (err) {
      setDocError(err.message || 'Could not open document');
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{entry.serial_no}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="detail-grid">
          <Detail label="Owner" value={entry.owner_name} />
          <Detail label="Product" value={entry.product} />
          <Detail label="Issuer" value={entry.issuer || '—'} />
          <Detail label="Status" value={<span className={`badge status-${entry.status}`}>{entry.status}</span>} />
          <Detail label="Amount invested" value={`₹${formatMoney(entry.amount)}`} />
          <Detail label="Maturity amount" value={`₹${formatMoney(entry.maturity_amount)}`} />
          <Detail label="Projected gain" value={`₹${formatMoney(gain)}`} />
          <Detail label="Premium frequency" value={entry.premium_frequency || '—'} />
          <Detail label="Date of issue" value={entry.date_of_issue} />
          <Detail
            label="Date of maturity"
            value={(
              <>
                {entry.date_of_maturity}
                {active && days >= 0 && days <= 90 && <span className="badge badge-warn">{days}d left</span>}
                {active && days < 0 && <span className="badge badge-danger">{Math.abs(days)}d overdue</span>}
              </>
            )}
          />
          <Detail label="Nominee" value={entry.nominee_name} />
          <Detail label="Nominee relation" value={entry.nominee_relation || '—'} />
        </div>

        <div className="detail-block">
          <span className="detail-label">Remarks</span>
          <div className="detail-value detail-remarks">{entry.remarks || '—'}</div>
        </div>

        <div className="detail-block">
          <span className="detail-label">Document</span>
          {entry.document_path ? (
            <button type="button" className="link-btn" disabled={opening} onClick={handleOpenDocument}>
              {opening ? 'Opening...' : `📎 ${entry.document_original_name || 'View document'}`}
            </button>
          ) : (
            <div className="detail-value">No document attached</div>
          )}
          {docError && <div className="form-error">{docError}</div>}
        </div>

        <div className="detail-block">
          <span className="detail-label">Linked notes</span>
          {notes.length === 0 ? (
            <div className="detail-value">None</div>
          ) : (
            <ul className="detail-notes">
              {notes.map((note) => (
                <li key={note.id}>
                  {note.title ? <strong>{note.title}: </strong> : null}
                  {note.content}
                  <span className="muted"> · {formatDateTime(note.updated_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="btn btn-primary" onClick={onEdit}>Edit</button>
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <span className="detail-label">{label}</span>
      <div className="detail-value">{value}</div>
    </div>
  );
}
