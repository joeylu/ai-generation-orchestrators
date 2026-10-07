/** Presentation scaling only; the session retains the exact continuous host value. */
export function progressDisplayValue(row, field, value) {
  return row.format.mode === 'percent' ? value / field.max * 100 : value;
}
export function progressDisplayMax(row, field) {
  return row.format.mode === 'percent' ? 100 : field.max;
}
export function progressText(row, field, value) {
  return progressDisplayValue(row, field, value).toFixed(row.format.fractionDigits)
    + (row.format.mode === 'percent' ? '%' : '');
}
/** Reserve enough text space for any value in the range, including rounded max. */
export function progressValueWidth(row, field, fontSize) {
  const max = progressDisplayMax(row, field), digits = row.format.fractionDigits;
  const length = Math.max(max.toFixed(digits).length,
    max >= 1e21 ? 21 + (digits ? digits + 1 : 0) : 0) + (row.format.mode === 'percent' ? 1 : 0);
  return Math.max(64, Math.ceil(length * fontSize * 0.8) + 8);
}
