export function formatMoney(n) {
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

export function formatDateTime(iso) {
  if (!iso) return '';
  return new Date(String(iso).replace(' ', 'T') + 'Z').toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function csvCell(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
