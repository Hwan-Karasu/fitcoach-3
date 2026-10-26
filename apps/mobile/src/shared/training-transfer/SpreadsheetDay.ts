/** Preserve the calendar day without applying the device timezone. */
export function spreadsheetDay(value: unknown, date1904 = false): string | null {
  let day: string;
  if (typeof value === "number" && Number.isFinite(value) && value >= (date1904 ? 0 : 1)) {
    const serial = Math.floor(value); if (!date1904 && serial === 60) return null;
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, serial < 60 ? 31 : 30);
    const date = new Date(epoch + serial * 86400000); if (!Number.isFinite(date.getTime())) return null;
    day = date.toISOString().slice(0, 10);
  } else {
    const text = String(value ?? "").trim(); const parts = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/u.exec(text);
    day = parts ? `${parts[3]}-${parts[2]!.padStart(2, "0")}-${parts[1]!.padStart(2, "0")}` : text;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(day) || !Number.isFinite(Date.parse(day)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return null;
  return day;
}
