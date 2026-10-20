/** Exact centimetres with at most one decimal place; no floating-point rounding. */
export function parseHeightCmX10(draft: string): number | null | "invalid" {
  const text = draft.trim();
  if (!text) return null;
  if (!/^\d+(?:[.,]\d)?$/u.test(text)) return "invalid";
  const [whole, decimal = ""] = text.replace(",", ".").split(".");
  const scaled = BigInt(whole!) * 10n + BigInt(decimal || "0");
  return scaled > 0n && scaled <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Number(scaled) : "invalid";
}

export function formatHeightCmX10(value: number | null): string {
  if (value === null) return "";
  const whole = Math.floor(value / 10);
  const fraction = value % 10;
  return fraction === 0 ? String(whole) : `${whole},${fraction}`;
}

/** Valid calendar date strictly before today's local date; no arbitrary age cap. */
export function validPastBirthDate(value: string | null): boolean {
  if (value === null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year === 0) return false;
  const date = new Date(0);
  date.setUTCFullYear(year!, month! - 1, day!);
  date.setUTCHours(0, 0, 0, 0);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month
    || date.getUTCDate() !== day) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return value < today;
}

/** Полных лет на дату `today` (`ГГГГ-ММ-ДД`); нет даты рождения, нечитаемая дата или рождение в будущем — `null`, а не ноль. 29 февраля в невисокосный год — с 1 марта. */
export function ageOn(birthDate: string | null, today: string): number | null {
  if (birthDate === null || !/^\d{4}-\d{2}-\d{2}$/u.test(birthDate) || !/^\d{4}-\d{2}-\d{2}$/u.test(today) || birthDate > today) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = today.split("-").map(Number) as [number, number, number];
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
}
