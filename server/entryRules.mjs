// Rules for a finance entry, shared by the entry form (browser) and the API
// (server), so both accept and reject exactly the same input.

export const PRODUCT_MAX = 60;
export const NAME_MAX = 100;
export const RELATION_MAX = 40;
export const ISSUER_MAX = 100;
export const REMARKS_MAX = 1000;
export const SERIAL_MIN = 3;
export const SERIAL_MAX = 40;
export const AMOUNT_MAX = 100_000_000_000; // ₹10,000 crore
export const RATE_MAX = 50;
export const EARLIEST_YEAR = 1950;
export const LATEST_YEAR = 2100;
export const MAX_TERM_YEARS = 100;

export const STATUSES = ['active', 'matured', 'claimed', 'lapsed', 'surrendered'];
export const FREQUENCIES = ['One-time', 'Monthly', 'Quarterly', 'Half-yearly', 'Yearly', 'N/A'];

// Letters, digits, spaces and - / . only. Catches typos such as a trailing ":".
const SERIAL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/;
// Letters in any script, spaces and the punctuation found in names ("D'Souza", "A. K. Singh", "Ram & Sita").
const NAME_PATTERN = /^[\p{L}\p{M}][\p{L}\p{M} .'&,()/-]*$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function text(value) {
  return String(value ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍﻿]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .trim();
}

function number(value) {
  const raw = String(value ?? '').replace(/[,\s₹]/g, '');
  if (raw === '') return null;
  return /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : Number.NaN;
}

// Same serial regardless of case, spaces or dashes, so "AB-12 34" matches "ab1234".
export function serialKey(serial) {
  return text(serial).toUpperCase().replace(/[\s./-]/g, '');
}

// Cleans user input into the stored shape: trimmed text, single spaces, numbers as numbers.
export function normalizeEntry(input) {
  const groupRaw = input.group_id;
  const groupId = groupRaw === '' || groupRaw == null ? null : Number(groupRaw);
  return {
    serial_no: text(input.serial_no),
    owner_name: text(input.owner_name),
    product: text(input.product),
    issuer: text(input.issuer) || null,
    amount: number(input.amount),
    interest_rate: number(input.interest_rate),
    maturity_amount: number(input.maturity_amount),
    date_of_issue: text(input.date_of_issue),
    date_of_maturity: text(input.date_of_maturity),
    nominee_name: text(input.nominee_name),
    nominee_relation: text(input.nominee_relation) || null,
    premium_frequency: text(input.premium_frequency) || 'One-time',
    status: text(input.status).toLowerCase() || 'active',
    remarks: String(input.remarks ?? '').replace(/\r\n/g, '\n').trim() || null,
    group_id: Number.isInteger(groupId) && groupId > 0 ? groupId : (groupId == null ? null : Number.NaN),
  };
}

function parseDate(value) {
  const match = DATE_PATTERN.exec(value || '');
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Rejects dates such as 2023-02-30 that roll over into the next month.
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date;
}

function decimals(value) {
  const [, fraction = ''] = String(value).split('.');
  return fraction.length;
}

function checkName(value, label, { required }) {
  if (!value) return required ? `${label} is required` : null;
  if (value.length < 2) return `${label} is too short`;
  if (value.length > NAME_MAX) return `${label} must be ${NAME_MAX} characters or fewer`;
  if (!NAME_PATTERN.test(value)) return `${label} can only contain letters, spaces and . ' & , ( ) / -`;
  return null;
}

function checkMoney(value, label, { required, allowZero }) {
  if (value == null) return required ? `${label} is required` : null;
  if (Number.isNaN(value)) return `${label} must be a number`;
  if (value < 0) return `${label} cannot be negative`;
  if (value === 0 && !allowZero) return `${label} must be more than 0`;
  if (value > AMOUNT_MAX) return `${label} is too large`;
  if (decimals(value) > 2) return `${label} can have at most 2 decimal places`;
  return null;
}

/**
 * Checks a normalized entry. `entries` are the existing records (for the
 * duplicate serial check) and `selfId` the entry being edited, if any.
 * Returns `errors` (field -> message, blocks saving) and `warnings`
 * (messages worth a second look that do not block saving).
 */
export function checkEntry(row, { entries = [], selfId = null, today = new Date() } = {}) {
  const errors = {};
  const warnings = [];
  const set = (field, message) => { if (message && !errors[field]) errors[field] = message; };

  // Serial / policy number
  if (!row.serial_no) set('serial_no', 'Serial / policy number is required');
  else if (row.serial_no.length < SERIAL_MIN) set('serial_no', `Serial / policy number must be at least ${SERIAL_MIN} characters`);
  else if (row.serial_no.length > SERIAL_MAX) set('serial_no', `Serial / policy number must be ${SERIAL_MAX} characters or fewer`);
  else if (!SERIAL_PATTERN.test(row.serial_no)) set('serial_no', 'Use only letters, numbers, spaces and - / . in the serial number');
  else {
    const key = serialKey(row.serial_no);
    const clash = entries.find((entry) => String(entry.id) !== String(selfId) && serialKey(entry.serial_no) === key);
    if (clash) set('serial_no', `Serial ${clash.serial_no} is already saved (owner ${clash.owner_name})`);
  }

  set('owner_name', checkName(row.owner_name, 'Owner name', { required: true }));
  set('nominee_name', checkName(row.nominee_name, 'Nominee name', { required: true }));

  if (row.nominee_relation) {
    if (row.nominee_relation.length > RELATION_MAX) set('nominee_relation', `Relation must be ${RELATION_MAX} characters or fewer`);
    else if (!NAME_PATTERN.test(row.nominee_relation)) set('nominee_relation', 'Relation can only contain letters and spaces');
  }

  if (!row.product) set('product', 'Product is required');
  else if (row.product.length > PRODUCT_MAX) set('product', `Product must be ${PRODUCT_MAX} characters or fewer`);

  if (row.issuer && row.issuer.length > ISSUER_MAX) set('issuer', `Issuer must be ${ISSUER_MAX} characters or fewer`);

  set('amount', checkMoney(row.amount, 'Amount', { required: true, allowZero: false }));
  set('maturity_amount', checkMoney(row.maturity_amount, 'Maturity amount', { required: true, allowZero: true }));

  if (row.interest_rate != null) {
    if (Number.isNaN(row.interest_rate)) set('interest_rate', 'Rate must be a number');
    else if (row.interest_rate < 0) set('interest_rate', 'Rate cannot be negative');
    else if (row.interest_rate > RATE_MAX) set('interest_rate', `Rate must be ${RATE_MAX}% or less`);
    else if (decimals(row.interest_rate) > 2) set('interest_rate', 'Rate can have at most 2 decimal places');
  }

  const issue = parseDate(row.date_of_issue);
  const maturity = parseDate(row.date_of_maturity);
  if (!row.date_of_issue) set('date_of_issue', 'Date of issue is required');
  else if (!issue) set('date_of_issue', 'Enter a real date');
  else if (issue.getUTCFullYear() < EARLIEST_YEAR) set('date_of_issue', `Date of issue must be ${EARLIEST_YEAR} or later`);
  else {
    const endOfToday = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    if (issue.getTime() > endOfToday) set('date_of_issue', 'Date of issue cannot be in the future');
  }
  if (!row.date_of_maturity) set('date_of_maturity', 'Date of maturity is required');
  else if (!maturity) set('date_of_maturity', 'Enter a real date');
  else if (maturity.getUTCFullYear() > LATEST_YEAR) set('date_of_maturity', `Date of maturity must be ${LATEST_YEAR} or earlier`);
  if (issue && maturity && !errors.date_of_issue && !errors.date_of_maturity) {
    if (maturity <= issue) set('date_of_maturity', 'Date of maturity must be after the date of issue');
    else if (maturity.getUTCFullYear() - issue.getUTCFullYear() > MAX_TERM_YEARS) {
      set('date_of_maturity', `Term cannot be longer than ${MAX_TERM_YEARS} years`);
    }
  }

  if (!FREQUENCIES.includes(row.premium_frequency)) set('premium_frequency', 'Choose a premium frequency from the list');
  if (!STATUSES.includes(row.status)) set('status', 'Choose a status from the list');
  if (row.remarks && row.remarks.length > REMARKS_MAX) set('remarks', `Remarks must be ${REMARKS_MAX} characters or fewer`);
  if (Number.isNaN(row.group_id)) set('group_id', 'Choose a group from the list');

  // Worth a second look, but allowed.
  if (!errors.amount && !errors.maturity_amount && row.maturity_amount < row.amount) {
    warnings.push('Maturity amount is less than the amount invested.');
  }
  if (!errors.amount && !errors.maturity_amount && row.amount > 0 && row.maturity_amount > row.amount * 10) {
    warnings.push('Maturity amount is more than 10 times the amount invested. Check for an extra digit.');
  }
  if (row.interest_rate != null && !errors.interest_rate && row.interest_rate > 15) {
    warnings.push(`A ${row.interest_rate}% rate is unusually high. Check it is correct.`);
  }
  if (maturity && !errors.date_of_maturity && row.status === 'active'
    && maturity.getTime() < Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) {
    warnings.push('The maturity date has passed but the status is still Active.');
  }

  return { errors, warnings };
}
