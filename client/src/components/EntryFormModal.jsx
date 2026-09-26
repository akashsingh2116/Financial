import { useState } from 'react';
import { PRODUCT_TYPES, STATUS_OPTIONS, PREMIUM_FREQUENCIES } from '../constants';
import { openDocument } from '../api';

const EMPTY_FORM = {
  serial_no: '',
  owner_name: '',
  product: PRODUCT_TYPES[0],
  product_other: '',
  issuer: '',
  amount: '',
  maturity_amount: '',
  date_of_issue: '',
  date_of_maturity: '',
  nominee_name: '',
  nominee_relation: '',
  premium_frequency: 'One-time',
  status: 'active',
  remarks: '',
};

function toFormState(entry) {
  if (!entry) return EMPTY_FORM;
  const isKnownProduct = PRODUCT_TYPES.includes(entry.product);
  return {
    serial_no: entry.serial_no || '',
    owner_name: entry.owner_name || '',
    product: isKnownProduct ? entry.product : 'Other',
    product_other: isKnownProduct ? '' : entry.product || '',
    issuer: entry.issuer || '',
    amount: entry.amount ?? '',
    maturity_amount: entry.maturity_amount ?? '',
    date_of_issue: entry.date_of_issue || '',
    date_of_maturity: entry.date_of_maturity || '',
    nominee_name: entry.nominee_name || '',
    nominee_relation: entry.nominee_relation || '',
    premium_frequency: entry.premium_frequency || 'One-time',
    status: entry.status || 'active',
    remarks: entry.remarks || '',
  };
}

const REQUIRED_LABELS = {
  serial_no: 'Serial / Policy No.',
  owner_name: 'Owner name',
  product: 'Product',
  amount: 'Amount',
  maturity_amount: 'Maturity amount',
  date_of_issue: 'Date of issue',
  date_of_maturity: 'Date of maturity',
  nominee_name: 'Nominee name',
};

export default function EntryFormModal({ entry, onClose, onSubmit }) {
  const [form, setForm] = useState(() => toFormState(entry));
  const [file, setFile] = useState(null);
  const [removeDocument, setRemoveDocument] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);

  const isEdit = Boolean(entry);

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function validate() {
    const next = {};
    const finalProduct = form.product === 'Other' ? form.product_other.trim() : form.product;

    if (!form.serial_no.trim()) next.serial_no = 'Required';
    if (!form.owner_name.trim()) next.owner_name = 'Required';
    if (!finalProduct) next.product = 'Required';
    if (form.amount === '' || Number.isNaN(Number(form.amount)) || Number(form.amount) < 0) {
      next.amount = 'Enter a valid amount';
    }
    if (form.maturity_amount === '' || Number.isNaN(Number(form.maturity_amount)) || Number(form.maturity_amount) < 0) {
      next.maturity_amount = 'Enter a valid amount';
    }
    if (!form.date_of_issue) next.date_of_issue = 'Required';
    if (!form.date_of_maturity) next.date_of_maturity = 'Required';
    if (form.date_of_issue && form.date_of_maturity && form.date_of_maturity < form.date_of_issue) {
      next.date_of_maturity = 'Must be on/after date of issue';
    }
    if (!form.nominee_name.trim()) next.nominee_name = 'Required';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleFileChange(e) {
    const f = e.target.files?.[0];
    if (!f) {
      setFile(null);
      return;
    }
    const okType = f.type.startsWith('image/') || f.type === 'application/pdf';
    if (!okType) {
      setSubmitError('Only image or PDF files are allowed.');
      e.target.value = '';
      setFile(null);
      return;
    }
    if (f.size > 15 * 1024 * 1024) {
      setSubmitError('File must be under 15 MB.');
      e.target.value = '';
      setFile(null);
      return;
    }
    setSubmitError('');
    setFile(f);
    setRemoveDocument(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError('');
    if (!validate()) return;

    const finalProduct = form.product === 'Other' ? form.product_other.trim() : form.product;
    const fd = new FormData();
    fd.append('serial_no', form.serial_no.trim());
    fd.append('owner_name', form.owner_name.trim());
    fd.append('product', finalProduct);
    fd.append('issuer', form.issuer.trim());
    fd.append('amount', form.amount);
    fd.append('maturity_amount', form.maturity_amount);
    fd.append('date_of_issue', form.date_of_issue);
    fd.append('date_of_maturity', form.date_of_maturity);
    fd.append('nominee_name', form.nominee_name.trim());
    fd.append('nominee_relation', form.nominee_relation.trim());
    fd.append('premium_frequency', form.premium_frequency);
    fd.append('status', form.status);
    fd.append('remarks', form.remarks.trim());
    if (file) fd.append('document', file);
    if (removeDocument) fd.append('remove_document', 'true');

    setSaving(true);
    try {
      await onSubmit(fd);
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h2>{isEdit ? 'Edit Entry' : 'Add Finance Entry'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="entry-form">
          <div className="form-grid">
            <Field label={`${REQUIRED_LABELS.serial_no} *`} error={errors.serial_no}>
              <input value={form.serial_no} onChange={(e) => update('serial_no', e.target.value)} placeholder="e.g. LIC-882910" />
            </Field>

            <Field label={`${REQUIRED_LABELS.owner_name} *`} error={errors.owner_name}>
              <input value={form.owner_name} onChange={(e) => update('owner_name', e.target.value)} placeholder="Policy holder name" />
            </Field>

            <Field label={`${REQUIRED_LABELS.product} *`} error={errors.product}>
              <select value={form.product} onChange={(e) => update('product', e.target.value)}>
                {PRODUCT_TYPES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              {form.product === 'Other' && (
                <input
                  className="mt-sm"
                  value={form.product_other}
                  onChange={(e) => update('product_other', e.target.value)}
                  placeholder="Specify product type"
                />
              )}
            </Field>

            <Field label="Issuer / Company" hint="e.g. LIC of India, SBI, HDFC">
              <input value={form.issuer} onChange={(e) => update('issuer', e.target.value)} placeholder="Optional" />
            </Field>

            <Field label={`${REQUIRED_LABELS.amount} (₹) *`} error={errors.amount}>
              <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => update('amount', e.target.value)} placeholder="Invested / premium amount" />
            </Field>

            <Field label={`${REQUIRED_LABELS.maturity_amount} (₹) *`} error={errors.maturity_amount}>
              <input type="number" min="0" step="0.01" value={form.maturity_amount} onChange={(e) => update('maturity_amount', e.target.value)} placeholder="Expected amount at maturity" />
            </Field>

            <Field label={`${REQUIRED_LABELS.date_of_issue} *`} error={errors.date_of_issue}>
              <input type="date" value={form.date_of_issue} onChange={(e) => update('date_of_issue', e.target.value)} />
            </Field>

            <Field label={`${REQUIRED_LABELS.date_of_maturity} *`} error={errors.date_of_maturity}>
              <input type="date" value={form.date_of_maturity} onChange={(e) => update('date_of_maturity', e.target.value)} />
            </Field>

            <Field label={`${REQUIRED_LABELS.nominee_name} *`} error={errors.nominee_name}>
              <input value={form.nominee_name} onChange={(e) => update('nominee_name', e.target.value)} placeholder="Nominee full name" />
            </Field>

            <Field label="Nominee relation">
              <input value={form.nominee_relation} onChange={(e) => update('nominee_relation', e.target.value)} placeholder="e.g. Spouse, Son, Daughter" />
            </Field>

            <Field label="Premium frequency">
              <select value={form.premium_frequency} onChange={(e) => update('premium_frequency', e.target.value)}>
                {PREMIUM_FREQUENCIES.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </Field>

            <Field label="Status">
              <select value={form.status} onChange={(e) => update('status', e.target.value)}>
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Remarks">
            <textarea rows={2} value={form.remarks} onChange={(e) => update('remarks', e.target.value)} placeholder="Any additional details..." />
          </Field>

          <Field label="Document (image or PDF)">
            <input type="file" accept="image/*,application/pdf" onChange={handleFileChange} />
            {isEdit && entry?.document_path && !file && !removeDocument && (
              <div className="existing-doc">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => openDocument(entry.id).catch((err) => setSubmitError(err.message))}
                >
                  📎 {entry.document_original_name || 'View current document'}
                </button>
                <button type="button" className="link-btn danger" onClick={() => setRemoveDocument(true)}>Remove</button>
              </div>
            )}
            {removeDocument && <div className="hint">Document will be removed on save.</div>}
          </Field>

          {submitError && <div className="form-error">{submitError}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Add Entry'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, error, hint, children }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && !error && <span className="field-hint">{hint}</span>}
      {error && <span className="field-error">{error}</span>}
    </label>
  );
}
