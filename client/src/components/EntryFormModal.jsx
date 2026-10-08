import { useRef, useState } from 'react';
import { PRODUCT_TYPES, STATUS_OPTIONS, PREMIUM_FREQUENCIES } from '../constants';
import DocumentPreview from './DocumentPreview';
import { calculateMaturityAmount } from '../interest';
import {
  checkEntry, normalizeEntry, ISSUER_MAX, NAME_MAX, PRODUCT_MAX, RELATION_MAX, REMARKS_MAX, SERIAL_MAX,
} from '../../../server/entryRules.mjs';
import { ACCEPTED_TYPES, prepareUpload } from '../prepareUpload';

const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const EMPTY_FORM = {
  serial_no: '',
  owner_name: '',
  product: PRODUCT_TYPES[0],
  product_other: '',
  issuer: '',
  amount: '',
  interest_rate: '',
  maturity_amount: '',
  date_of_issue: '',
  date_of_maturity: '',
  nominee_name: '',
  nominee_relation: '',
  premium_frequency: 'One-time',
  status: 'active',
  group_id: '',
  remarks: '',
};

function toFormState(entry, defaultGroupId = '') {
  if (!entry) return { ...EMPTY_FORM, group_id: defaultGroupId ? String(defaultGroupId) : '' };
  const isKnownProduct = PRODUCT_TYPES.includes(entry.product);
  return {
    serial_no: entry.serial_no || '',
    owner_name: entry.owner_name || '',
    product: isKnownProduct ? entry.product : 'Other',
    product_other: isKnownProduct ? '' : entry.product || '',
    issuer: entry.issuer || '',
    amount: entry.amount ?? '',
    interest_rate: entry.interest_rate ?? '',
    maturity_amount: entry.maturity_amount ?? '',
    date_of_issue: entry.date_of_issue || '',
    date_of_maturity: entry.date_of_maturity || '',
    nominee_name: entry.nominee_name || '',
    nominee_relation: entry.nominee_relation || '',
    premium_frequency: entry.premium_frequency || 'One-time',
    status: entry.status || 'active',
    group_id: entry.group_id == null || entry.group_id === '' ? '' : String(entry.group_id),
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

export default function EntryFormModal({ entry, entries = [], groups = [], defaultGroupId = '', onClose, onSubmit }) {
  const [form, setForm] = useState(() => toFormState(entry, defaultGroupId));
  const [file, setFile] = useState(null);
  const [removeDocument, setRemoveDocument] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');
  const [saving, setSaving] = useState(false);
  const [warnings, setWarnings] = useState([]);
  const [acceptedWarnings, setAcceptedWarnings] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [fileNote, setFileNote] = useState('');
  // Set synchronously so a fast second tap cannot submit the same entry twice.
  const submittingRef = useRef(false);
  const formRef = useRef(null);

  const isEdit = Boolean(entry);

  const MATURITY_INPUTS = new Set([
  'interest_rate', 'amount', 'date_of_issue', 'date_of_maturity', 'premium_frequency', 'product',
]);

function update(field, value) {
    // Editing a field clears its message; everything is checked again on Save.
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
    setForm((current) => {
      const next = { ...current, [field]: value };
      if (!MATURITY_INPUTS.has(field)) return next;
      const calculated = calculateMaturityAmount(next);
      if (calculated != null) next.maturity_amount = String(calculated);
      return next;
    });
  }

  // Runs the same rules as the server. Returns the cleaned entry, or null
  // when something must be fixed (errors are shown next to the fields).
  function validate() {
    const finalProduct = form.product === 'Other' ? form.product_other : form.product;
    const row = normalizeEntry({ ...form, product: finalProduct });
    const result = checkEntry(row, { entries, selfId: entry?.id ?? null });
    setErrors(result.errors);
    setWarnings(result.warnings);
    if (Object.keys(result.errors).length) {
      // Bring the first problem into view, which matters on a phone.
      requestAnimationFrame(() => formRef.current?.querySelector('.field-error')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return null;
    }
    return { row, warningKey: result.warnings.join('|') };
  }

  async function handleFileChange(e) {
    const input = e.target;
    const chosen = input.files?.[0];
    setFileNote('');
    setErrors((current) => ({ ...current, document: undefined }));
    if (!chosen) {
      setFile(null);
      return;
    }
    setPreparing(true);
    const result = await prepareUpload(chosen);
    setPreparing(false);
    if (result.error) {
      setErrors((current) => ({ ...current, document: result.error }));
      input.value = '';
      setFile(null);
      return;
    }
    if (result.shrunk) {
      setFileNote(`Photo reduced from ${(result.shrunk.from / 1048576).toFixed(1)} MB to ${(result.shrunk.to / 1048576).toFixed(1)} MB so it uploads quickly.`);
    }
    setFile(result.file);
    setRemoveDocument(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (submittingRef.current || preparing) return;
    setSubmitError('');
    const checked = validate();
    if (!checked) return;
    // Warnings do not block, but the first Save shows them; the next one saves.
    if (checked.warningKey && checked.warningKey !== acceptedWarnings) {
      setAcceptedWarnings(checked.warningKey);
      return;
    }

    const { row } = checked;
    const fd = new FormData();
    for (const key of [
      'serial_no', 'owner_name', 'product', 'issuer', 'amount', 'interest_rate', 'maturity_amount',
      'date_of_issue', 'date_of_maturity', 'nominee_name', 'nominee_relation', 'premium_frequency',
      'status', 'remarks',
    ]) {
      fd.append(key, row[key] == null ? '' : String(row[key]));
    }
    fd.append('group_id', row.group_id == null ? '' : String(row.group_id));
    if (file) fd.append('document', file);
    if (removeDocument) fd.append('remove_document', 'true');

    submittingRef.current = true;
    setSaving(true);
    try {
      await onSubmit(fd);
    } catch (err) {
      setSubmitError(err.message || 'Something went wrong');
    } finally {
      submittingRef.current = false;
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

        <form ref={formRef} onSubmit={handleSubmit} className="entry-form" noValidate>
          <div className="form-grid">
            <Field label={`${REQUIRED_LABELS.serial_no} *`} error={errors.serial_no}>
              <input value={form.serial_no} onChange={(e) => update('serial_no', e.target.value)} placeholder="e.g. LIC-882910" maxLength={SERIAL_MAX} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
            </Field>

            <Field label={`${REQUIRED_LABELS.owner_name} *`} error={errors.owner_name}>
              <input value={form.owner_name} onChange={(e) => update('owner_name', e.target.value)} placeholder="Policy holder name" maxLength={NAME_MAX} autoCapitalize="words" />
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
                  maxLength={PRODUCT_MAX}
                />
              )}
            </Field>

            <Field label="Group" hint="Keeps this entry with the other records in that group.">
              <select value={form.group_id} onChange={(e) => update('group_id', e.target.value)}>
                <option value="">No group</option>
                {groups.map((group) => <option key={group.id} value={String(group.id)}>{group.name}</option>)}
              </select>
            </Field>

            <Field label="Issuer / Company" hint="e.g. LIC of India, SBI, HDFC">
              <input value={form.issuer} onChange={(e) => update('issuer', e.target.value)} placeholder="Optional" maxLength={ISSUER_MAX} />
            </Field>

            <Field label={`${REQUIRED_LABELS.amount} (₹) *`} error={errors.amount}>
              <input type="number" inputMode="decimal" min="0" step="0.01" value={form.amount} onChange={(e) => update('amount', e.target.value)} onWheel={(e) => e.currentTarget.blur()} placeholder="Invested / premium amount" />
            </Field>

            <Field label="Rate of interest (%)" error={errors.interest_rate} hint="Optional. Fills the maturity amount from the amount, dates, and premium frequency.">
              <input type="number" inputMode="decimal" min="0" max="50" step="0.01" value={form.interest_rate} onChange={(e) => update('interest_rate', e.target.value)} onWheel={(e) => e.currentTarget.blur()} placeholder="e.g. 7.5" />
            </Field>

            <Field
              label={`${REQUIRED_LABELS.maturity_amount} (₹) *`}
              error={errors.maturity_amount}
              hint={form.interest_rate !== '' ? 'Calculated from the rate of interest. You can still edit it.' : undefined}
            >
              <input type="number" inputMode="decimal" min="0" step="0.01" value={form.maturity_amount} onChange={(e) => update('maturity_amount', e.target.value)} onWheel={(e) => e.currentTarget.blur()} placeholder="Expected amount at maturity" />
            </Field>

            <Field label={`${REQUIRED_LABELS.date_of_issue} *`} error={errors.date_of_issue}>
              <input type="date" min="1950-01-01" max={todayIso()} value={form.date_of_issue} onChange={(e) => update('date_of_issue', e.target.value)} />
            </Field>

            <Field label={`${REQUIRED_LABELS.date_of_maturity} *`} error={errors.date_of_maturity}>
              <input type="date" min={form.date_of_issue || '1950-01-01'} max="2100-12-31" value={form.date_of_maturity} onChange={(e) => update('date_of_maturity', e.target.value)} />
            </Field>

            <Field label={`${REQUIRED_LABELS.nominee_name} *`} error={errors.nominee_name}>
              <input value={form.nominee_name} onChange={(e) => update('nominee_name', e.target.value)} placeholder="Nominee full name" maxLength={NAME_MAX} autoCapitalize="words" />
            </Field>

            <Field label="Nominee relation" error={errors.nominee_relation}>
              <input value={form.nominee_relation} onChange={(e) => update('nominee_relation', e.target.value)} placeholder="e.g. Spouse, Son, Daughter" maxLength={RELATION_MAX} autoCapitalize="words" />
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

          <Field label="Remarks" error={errors.remarks} hint={form.remarks.length > REMARKS_MAX - 100 ? `${form.remarks.length} / ${REMARKS_MAX} characters` : undefined}>
            <textarea rows={2} value={form.remarks} onChange={(e) => update('remarks', e.target.value)} placeholder="Any additional details..." maxLength={REMARKS_MAX} />
          </Field>

          <Field label="Document (image or PDF)" error={errors.document} hint={preparing ? 'Preparing photo…' : fileNote || 'JPG, PNG, WEBP, GIF or PDF, up to 4 MB. Large photos are reduced automatically.'}>
            <input type="file" accept={ACCEPTED_TYPES.join(',')} onChange={handleFileChange} disabled={saving} />
            {file && <DocumentPreview file={file} />}
            {isEdit && entry?.document_path && !file && !removeDocument && (
              <div className="existing-doc">
                <DocumentPreview entryId={entry.id} name={entry.document_original_name} />
                <button type="button" className="link-btn danger" onClick={() => setRemoveDocument(true)}>Remove document</button>
              </div>
            )}
            {removeDocument && <div className="hint">Document will be removed on save.</div>}
          </Field>

          {warnings.length > 0 && Object.keys(errors).filter((key) => errors[key]).length === 0 && (
            <div className="form-warning" role="status">
              <strong>Please double-check:</strong>
              <ul>{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              <span>Save again to keep it as it is.</span>
            </div>
          )}
          {submitError && <div className="form-error">{submitError}</div>}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || preparing}>
              {saving
                ? 'Saving...'
                : warnings.length > 0 && acceptedWarnings === warnings.join('|')
                  ? 'Save anyway'
                  : isEdit ? 'Save Changes' : 'Add Entry'}
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
