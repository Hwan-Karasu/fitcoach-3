import type { CreditScope, NewPackInput, NewPaymentInput } from "./AccountingModel.ts";

function isLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const check = new Date(Date.UTC(year, month - 1, day));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

/** Exact rubles → kopeks: "8000", "8 000", "1700,50"; never rounds a third decimal. */
export function parseRublesToKopeks(raw: string): number | "empty" | "invalid" {
  const value = raw.replace(/[\s\u00a0]/gu, "");
  if (!value) return "empty";
  const match = /^(\d{1,9})(?:[.,](\d{1,2}))?$/u.exec(value);
  if (!match) return "invalid";
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function formatKopeks(kopeks: number): string {
  const rubles = Math.trunc(kopeks / 100);
  const rest = Math.abs(kopeks % 100);
  const grouped = String(Math.abs(rubles)).replace(/\B(?=(\d{3})+(?!\d))/gu, "\u00a0");
  return `${kopeks < 0 ? "−" : ""}${grouped}${rest === 0 ? "" : `,${String(rest).padStart(2, "0")}`}\u00a0₽`;
}

/** Derived, never stored: total price / sessions, in whole kopeks. */
export function pricePerSessionKopeks(totalKopeks: number, sessions: number): number {
  return sessions > 0 ? Math.round(totalKopeks / sessions) : 0;
}

export function validatePack(input: NewPackInput): NewPackInput {
  const title = input.title.trim();
  if (!title || title.length > 120) throw new Error("ACCOUNTING_PACK_INVALID");
  if (!Number.isSafeInteger(input.grantedCount) || input.grantedCount < 1 || input.grantedCount > 1000
    || !Number.isSafeInteger(input.totalKopeks) || input.totalKopeks < 0) {
    throw new Error("ACCOUNTING_PACK_INVALID");
  }
  const scoped: CreditScope = input.creditScope;
  if ((scoped === "GENERAL" && input.sessionTypeId !== null)
    || (scoped === "SESSION_TYPE" && (input.sessionTypeId === null || !input.sessionTypeName))
    || (scoped !== "GENERAL" && scoped !== "SESSION_TYPE")) {
    throw new Error("ACCOUNTING_PACK_SCOPE_INVALID");
  }
  if (input.expiresOn !== null && !isLocalDate(input.expiresOn)) throw new Error("ACCOUNTING_PACK_INVALID");
  return { ...input, title };
}

export function validatePayment(input: NewPaymentInput): NewPaymentInput {
  if (!Number.isSafeInteger(input.amountKopeks) || input.amountKopeks <= 0 || !isLocalDate(input.paidOn)
    || !["transfer", "cash", "other"].includes(input.method)) {
    throw new Error("ACCOUNTING_PAYMENT_INVALID");
  }
  const note = input.note?.trim() || null;
  if (note !== null && note.length > 500) throw new Error("ACCOUNTING_PAYMENT_INVALID");
  return { ...input, note };
}

export interface AllocationCandidate {
  readonly id: string;
  readonly creditScope: CreditScope;
  readonly sessionTypeId: string | null;
  readonly expiresOn: string | null;
  readonly createdAt: string;
  readonly available: number;
}

/**
 * §22.1.2 allocation: a matching SESSION_TYPE credit before GENERAL; inside a scope the nearest
 * expiration, then the oldest pack without expiry. Expired or empty packs never qualify.
 */
export function choosePack(candidates: readonly AllocationCandidate[], sessionTypeId: string,
  today: string): AllocationCandidate | null {
  const usable = candidates.filter((pack) => pack.available >= 1
    && (pack.expiresOn === null || pack.expiresOn >= today)
    && (pack.creditScope === "GENERAL" || pack.sessionTypeId === sessionTypeId));
  const rank = (pack: AllocationCandidate) => pack.creditScope === "SESSION_TYPE" ? 0 : 1;
  return [...usable].sort((a, b) => rank(a) - rank(b)
    || (a.expiresOn === null ? 1 : 0) - (b.expiresOn === null ? 1 : 0)
    || (a.expiresOn ?? "").localeCompare(b.expiresOn ?? "")
    || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))[0] ?? null;
}
