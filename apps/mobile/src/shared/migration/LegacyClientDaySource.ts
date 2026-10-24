export type LegacyNumericStatus = "missing" | "decimal-dot" | "decimal-comma" | "invalid" | "negative";

export interface LegacyClientDaySource {
  readonly accountScope: string;
  readonly clientId: string;
  readonly dateKey: string;
  readonly ownerFound: boolean;
  readonly validLocalDate: boolean;
  readonly weightStatus: LegacyNumericStatus;
  /** Retained only inside the read-only preflight for exact source-value comparison. */
  readonly weightRaw: unknown;
  readonly stepsStatus: LegacyNumericStatus;
  readonly trainingStatus: "yes" | "no" | "missing" | "unknown";
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function numericStatus(value: unknown, integer: boolean): LegacyNumericStatus {
  if (value === null || typeof value === "string" && !value.trim()) return "missing";
  if (typeof value !== "string" || !/^[-+]?\d+(?:[.,]\d+)?$/u.test(value.trim())) return "invalid";
  const numeric = Number(value.replace(",", "."));
  if (!Number.isFinite(numeric) || integer && (!Number.isSafeInteger(numeric)
    || !/^[-+]?\d+$/u.test(value.trim()))) return "invalid";
  if (numeric < 0) return "negative";
  return value.includes(",") ? "decimal-comma" : "decimal-dot";
}

function trainingStatus(value: unknown): LegacyClientDaySource["trainingStatus"] {
  if (value === null || typeof value === "string" && !value.trim()) return "missing";
  if (typeof value !== "string") return "unknown";
  const normalized = value.trim().toLowerCase();
  return normalized === "да" ? "yes" : normalized === "нет" ? "no" : "unknown";
}

export function projectLegacyClientDaySourceRow(accountScope: string, row: Readonly<Record<string, unknown>>, ownerFound: boolean): LegacyClientDaySource {
  if (!accountScope.trim() || typeof row.client_id !== "string" || !row.client_id.trim() || typeof row.date_key !== "string" || !row.date_key.trim()
    || ["weight", "steps", "training"].some((field) => !Object.hasOwn(row, field))) throw new Error("R04_CLIENT_DAY_PROVENANCE_INCOMPLETE");
  return { accountScope, clientId: row.client_id, dateKey: row.date_key, ownerFound, validLocalDate: validDate(row.date_key),
    weightStatus: numericStatus(row.weight, false), weightRaw: row.weight,
    stepsStatus: numericStatus(row.steps, true), trainingStatus: trainingStatus(row.training) };
}
