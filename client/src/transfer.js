import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import { csvCell } from './format.js';

const STATUSES = new Set(['active', 'matured', 'claimed', 'lapsed', 'surrendered']);

export const TRANSFER_FIELDS = [
  { key: 'serial_no', label: 'Serial No', required: true },
  { key: 'owner_name', label: 'Owner', required: true },
  { key: 'product', label: 'Product', required: true },
  { key: 'issuer', label: 'Issuer' },
  { key: 'amount', label: 'Amount', required: true, number: true },
  { key: 'maturity_amount', label: 'Maturity Amount', required: true, number: true },
  { key: 'date_of_issue', label: 'Issue Date', required: true, date: true },
  { key: 'date_of_maturity', label: 'Maturity Date', required: true, date: true },
  { key: 'nominee_name', label: 'Nominee', required: true },
  { key: 'nominee_relation', label: 'Nominee Relation' },
  { key: 'premium_frequency', label: 'Premium Frequency' },
  { key: 'status', label: 'Status' },
  { key: 'remarks', label: 'Remarks' },
];

const LABEL_TO_KEY = Object.fromEntries(
  TRANSFER_FIELDS.map((field) => [field.label.toLowerCase(), field.key]),
);

function textValue(entry, field) {
  const value = entry[field.key];
  if (value == null || value === '') return '';
  return String(value);
}

function downloadBytes(bytes, filename, type) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportCsv(entries) {
  const columns = [...TRANSFER_FIELDS.map((field) => [field.key, field.label]), ['document_original_name', 'Document']];
  const header = columns.map(([, label]) => csvCell(label)).join(',');
  const body = entries.map((entry) => columns.map(([key]) => csvCell(entry[key])).join(','));
  downloadBytes(
    new Blob([[header, ...body].join('\n')], { type: 'text/csv;charset=utf-8' }),
    'finance-entries.csv',
  );
}

export function buildExcel(entries) {
  const rows = entries.map((entry) => {
    const row = {};
    for (const field of TRANSFER_FIELDS) {
      row[field.label] = field.number ? Number(entry[field.key] ?? 0) : textValue(entry, field);
    }
    row.Document = entry.document_original_name || '';
    return row;
  });
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Entries');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx' });
}

export function exportExcel(entries) {
  downloadBytes(
    buildExcel(entries),
    'finance-entries.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}

export async function buildWord(entries) {
  const children = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun('Finance Tracker')],
    }),
    new Paragraph({
      spacing: { after: 240 },
      children: [new TextRun(`Exported ${new Date().toLocaleString('en-IN')} · ${entries.length} entries`)],
    }),
  ];

  for (const entry of entries) {
    children.push(new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun(textValue(entry, TRANSFER_FIELDS[0]) || 'Entry')],
    }));
    for (const field of TRANSFER_FIELDS) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: `${field.label}: `, bold: true }),
          new TextRun(textValue(entry, field)),
        ],
      }));
    }
    if (entry.document_original_name) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [
          new TextRun({ text: 'Document: ', bold: true }),
          new TextRun(entry.document_original_name),
        ],
      }));
    }
    children.push(new Paragraph({ spacing: { after: 200 }, children: [new TextRun('---')] }));
  }

  const doc = new Document({ sections: [{ children }] });
  return Packer.toBlob(doc);
}

export async function exportWord(entries) {
  downloadBytes(await buildWord(entries), 'finance-entries.docx');
}

export function buildPdf(entries) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const margin = 14;
  const maxWidth = doc.internal.pageSize.getWidth() - margin * 2;
  let y = 18;

  function addLine(text, { bold = false, size = 11 } = {}) {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    const lines = doc.splitTextToSize(text || ' ', maxWidth);
    const height = lines.length * (size * 0.45);
    if (y + height > 285) {
      doc.addPage();
      y = 18;
    }
    doc.text(lines, margin, y);
    y += height + 2.2;
  }

  addLine('Finance Tracker', { bold: true, size: 16 });
  addLine(`Exported ${new Date().toLocaleString('en-IN')} · ${entries.length} entries`, { size: 10 });
  y += 2;

  for (const entry of entries) {
    addLine(textValue(entry, TRANSFER_FIELDS[0]) || 'Entry', { bold: true, size: 13 });
    for (const field of TRANSFER_FIELDS) {
      addLine(`${field.label}: ${textValue(entry, field)}`);
    }
    if (entry.document_original_name) addLine(`Document: ${entry.document_original_name}`);
    addLine('---');
    y += 1.5;
  }

  return doc.output('arraybuffer');
}

export function exportPdf(entries) {
  downloadBytes(buildPdf(entries), 'finance-entries.pdf', 'application/pdf');
}

function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  if (value == null || String(value).trim() === '') return NaN;
  const cleaned = String(value).replace(/[₹,\s]/g, '').replace(/^rs\.?/i, '');
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : NaN;
}

function formatIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatIsoDate(value);
  if (typeof value === 'number' && value > 20000 && value < 80000) {
    return new Date(Math.round((value - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  }
  const text = value == null ? '' : String(value).trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return formatIsoDate(parsed);
  return '';
}

export function normalizeRecord(raw, rowNumber) {
  const keyed = {};
  for (const [key, value] of Object.entries(raw)) {
    const mapped = LABEL_TO_KEY[String(key).trim().toLowerCase()];
    if (mapped) keyed[mapped] = value;
    else if (TRANSFER_FIELDS.some((field) => field.key === key)) keyed[key] = value;
  }

  const errors = [];
  const record = {};
  for (const field of TRANSFER_FIELDS) {
    let value = keyed[field.key];
    if (field.date) value = parseDate(value);
    else if (field.number) value = parseAmount(value);
    else value = value == null ? '' : String(value).trim();

    if (field.key === 'status') {
      value = value ? String(value).trim().toLowerCase() : 'active';
      if (!STATUSES.has(value)) {
        errors.push(`Row ${rowNumber}: status must be active, matured, claimed, lapsed, or surrendered`);
      }
    }
    if (field.required && (value === '' || value == null || Number.isNaN(value))) {
      errors.push(`Row ${rowNumber}: ${field.label} is required`);
    }
    if (field.number && !Number.isNaN(value) && value < 0) {
      errors.push(`Row ${rowNumber}: ${field.label} cannot be negative`);
    }
    record[field.key] = value;
  }

  if (record.date_of_issue && record.date_of_maturity && record.date_of_maturity < record.date_of_issue) {
    errors.push(`Row ${rowNumber}: maturity date must be on or after the issue date`);
  }
  return { record, errors };
}

export function recordsFromSheetRows(rows) {
  const records = [];
  const errors = [];
  rows.forEach((row, index) => {
    const hasValue = Object.values(row).some((value) => String(value ?? '').trim() !== '');
    if (!hasValue) return;
    const result = normalizeRecord(row, index + 2);
    if (result.errors.length) errors.push(...result.errors);
    else records.push(result.record);
  });
  return { records, errors };
}

export function recordsFromText(text) {
  const blocks = String(text)
    .split(/\n\s*---\s*(?:\n|$)/)
    .map((block) => block.trim())
    .filter((block) => /serial no\s*:/i.test(block));

  const records = [];
  const errors = [];
  blocks.forEach((block, index) => {
    const raw = {};
    let currentKey = null;
    for (const line of block.split(/\r?\n/)) {
      const match = line.match(/^\s*([^:]+):\s*(.*)$/);
      if (match) {
        const mapped = LABEL_TO_KEY[match[1].trim().toLowerCase()];
        if (mapped) {
          currentKey = mapped;
          raw[mapped] = match[2].trim();
        }
        continue;
      }
      if (currentKey && line.trim()) {
        raw[currentKey] = `${raw[currentKey]} ${line.trim()}`.trim();
      }
    }
    const result = normalizeRecord(raw, index + 1);
    if (result.errors.length) errors.push(...result.errors);
    else records.push(result.record);
  });
  return { records, errors };
}

async function textFromPdf(data) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = new Map();
    for (const item of content.items) {
      if (!item.str) continue;
      const y = Math.round(item.transform[5]);
      const row = lines.get(y) || [];
      row.push({ x: item.transform[4], str: item.str });
      lines.set(y, row);
    }
    pages.push(
      [...lines.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, parts]) => parts.sort((a, b) => a.x - b.x).map((part) => part.str).join(' ').trim())
        .filter(Boolean)
        .join('\n'),
    );
  }
  return pages.join('\n');
}

export async function recordsFromFile(file) {
  const name = file.name.toLowerCase();
  const data = await file.arrayBuffer();

  if (name.endsWith('.pdf')) {
    return recordsFromText(await textFromPdf(data));
  }
  if (name.endsWith('.docx')) {
    const loaded = await import('mammoth');
    const mammoth = loaded.default || loaded;
    const input = { arrayBuffer: data };
    if (typeof Buffer !== 'undefined') input.buffer = Buffer.from(data);
    const result = await mammoth.extractRawText(input);
    return recordsFromText(result.value);
  }
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
    const book = XLSX.read(data, { type: 'array', cellDates: true });
    const sheet = book.Sheets[book.SheetNames[0]];
    if (!sheet) return { records: [], errors: ['The file has no sheet to read.'] };
    return recordsFromSheetRows(XLSX.utils.sheet_to_json(sheet, { defval: '' }));
  }
  return {
    records: [],
    errors: ['Import an Excel (.xlsx), Word (.docx), PDF, or CSV file exported from this app.'],
  };
}

export function entryKey(entry) {
  return `${entry.serial_no}`.trim().toLowerCase() + '|' + `${entry.owner_name}`.trim().toLowerCase();
}

export function toFormData(record) {
  const formData = new FormData();
  for (const field of TRANSFER_FIELDS) {
    const value = record[field.key];
    formData.append(field.key, value == null || Number.isNaN(value) ? '' : String(value));
  }
  return formData;
}
