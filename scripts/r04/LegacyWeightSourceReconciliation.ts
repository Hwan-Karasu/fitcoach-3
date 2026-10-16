import type { DatabaseSync } from "node:sqlite";
import type { LegacyClientDaySource } from "./LegacyClientDaySourceReader.ts";

export interface LegacyProfileWeightSource {
  readonly accountScope: string;
  readonly clientId: string;
  readonly weightRaw: unknown;
}

export interface DailyWeightCandidate {
  readonly sourceAtomKey: string;
  readonly accountScope: string;
  readonly clientId: string;
  readonly localDate: string;
  readonly normalizedDecimal: string | null;
  readonly datePrecision: "DATE";
  readonly measuredAt: null;
  readonly issues: readonly ("MISSING_OWNER" | "INVALID_DATE" | "INVALID_VALUE" |
    "NONPOSITIVE_VALUE" | "UNIT_UNVERIFIED")[];
  readonly targetMeasurementId: null;
}

/** Profile weight has no trustworthy measurement date and is never a target fact. */
export function readLegacyProfileWeightsInSnapshot(
  db: DatabaseSync, accountScope: string,
): readonly LegacyProfileWeightSource[] {
  if (!accountScope.trim()) throw new Error("R04_ACCOUNT_SCOPE_REQUIRED");
  const columns = new Set(db.prepare("PRAGMA table_info('clients')").all()
    .map((row) => String(row.name)));
  if (!columns.has("id") || !columns.has("weight")) throw new Error("R04_PROFILE_WEIGHT_SHAPE_UNSUPPORTED");
  const rows = db.prepare("SELECT id AS clientId, weight AS weightRaw FROM clients ORDER BY id").all();
  const count = db.prepare("SELECT count(*) AS count FROM clients").get() as { count: number };
  if (rows.length !== count.count) throw new Error("R04_PROFILE_WEIGHT_CARDINALITY_MISMATCH");
  return rows.map((row) => {
    if (typeof row.clientId !== "string" || !row.clientId.trim()) {
      throw new Error("R04_PROFILE_WEIGHT_PROVENANCE_INCOMPLETE");
    }
    return { accountScope, clientId: row.clientId, weightRaw: row.weightRaw };
  });
}

function exactDecimal(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^\d+(?:[.,]\d+)?$/u.test(text) ? text.replace(",", ".") : null;
}

function positiveDecimal(value: string): boolean {
  return /[1-9]/u.test(value);
}

function comparableDecimal(value: string): string {
  const [integer = "0", fractional = ""] = value.split(".");
  const whole = integer.replace(/^0+/u, "") || "0";
  const fraction = fractional.replace(/0+$/u, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function buildDailyWeightCandidates(
  rows: readonly LegacyClientDaySource[],
): readonly DailyWeightCandidate[] {
  const seen = new Set<string>();
  const candidates: DailyWeightCandidate[] = [];
  for (const row of rows) {
    if (!row.accountScope.trim() || !row.clientId.trim() || !row.dateKey.trim()) {
      throw new Error("R04_CLIENT_DAY_PROVENANCE_INCOMPLETE");
    }
    const key = JSON.stringify([row.accountScope, row.clientId, row.dateKey]);
    if (seen.has(key)) throw new Error("R04_DUPLICATE_CLIENT_DAY_KEY");
    seen.add(key);
    if (row.weightStatus === "missing") continue;
    const numeric = row.weightStatus === "decimal-dot" || row.weightStatus === "decimal-comma";
    const decimal = numeric ? exactDecimal(row.weightRaw) : null;
    if (numeric && decimal === null) throw new Error("R04_WEIGHT_STATUS_VALUE_MISMATCH");
    const issues: DailyWeightCandidate["issues"][number][] = [];
    if (!row.ownerFound) issues.push("MISSING_OWNER");
    if (!row.validLocalDate) issues.push("INVALID_DATE");
    if (row.weightStatus === "invalid") issues.push("INVALID_VALUE");
    else if (row.weightStatus === "negative" || decimal !== null && !positiveDecimal(decimal)) {
      issues.push("NONPOSITIVE_VALUE");
    } else issues.push("UNIT_UNVERIFIED");
    candidates.push({
      sourceAtomKey: JSON.stringify([row.accountScope, "client_day_facts", row.clientId,
        row.dateKey, "weight"]),
      accountScope: row.accountScope, clientId: row.clientId,
      localDate: row.dateKey, normalizedDecimal: decimal,
      datePrecision: "DATE", measuredAt: null, issues, targetMeasurementId: null,
    });
  }
  return candidates;
}

export interface WeightSourceReconciliationReport {
  readonly status: "requires-semantic-review";
  readonly profileRows: number;
  readonly profilePositiveSnapshots: number;
  readonly profileInvalidOrNonpositive: number;
  readonly dailyWeightRows: number;
  readonly dailyExactPositiveValues: number;
  readonly dailyBlockedValues: number;
  readonly clientsWithBothSources: number;
  readonly sameValueSignalClients: number;
  readonly noSameValueSignalClients: number;
  readonly targetMappedMeasurements: 0;
  readonly targetWrites: 0;
}

/** Compares source signals only; equality never merges or dates a profile snapshot. */
export function reconcileLegacyWeightSources(
  profiles: readonly LegacyProfileWeightSource[],
  days: readonly DailyWeightCandidate[],
): WeightSourceReconciliationReport {
  const profileValues = new Map<string, string>();
  const seenProfiles = new Set<string>();
  let profileInvalidOrNonpositive = 0;
  for (const profile of profiles) {
    if (!profile.accountScope.trim() || !profile.clientId.trim()) {
      throw new Error("R04_PROFILE_WEIGHT_PROVENANCE_INCOMPLETE");
    }
    const key = JSON.stringify([profile.accountScope, profile.clientId]);
    if (seenProfiles.has(key)) throw new Error("R04_DUPLICATE_PROFILE_WEIGHT_CLIENT");
    seenProfiles.add(key);
    if (profile.weightRaw === null || typeof profile.weightRaw === "string"
      && !profile.weightRaw.trim()) continue;
    const decimal = exactDecimal(profile.weightRaw);
    if (decimal === null || !positiveDecimal(decimal)) profileInvalidOrNonpositive += 1;
    else profileValues.set(key, comparableDecimal(decimal));
  }
  const dayValues = new Map<string, Set<string>>();
  let dailyExactPositiveValues = 0;
  let dailyBlockedValues = 0;
  for (const day of days) {
    if (day.normalizedDecimal === null || !positiveDecimal(day.normalizedDecimal)
      || day.issues.some((issue) => issue !== "UNIT_UNVERIFIED")) {
      dailyBlockedValues += 1;
      continue;
    }
    dailyExactPositiveValues += 1;
    const key = JSON.stringify([day.accountScope, day.clientId]);
    const values = dayValues.get(key) ?? new Set<string>();
    values.add(comparableDecimal(day.normalizedDecimal));
    dayValues.set(key, values);
  }
  let clientsWithBothSources = 0;
  let sameValueSignalClients = 0;
  for (const [clientKey, profileValue] of profileValues) {
    const values = dayValues.get(clientKey);
    if (!values) continue;
    clientsWithBothSources += 1;
    if (values.has(profileValue)) sameValueSignalClients += 1;
  }
  return {
    status: "requires-semantic-review", profileRows: profiles.length,
    profilePositiveSnapshots: profileValues.size, profileInvalidOrNonpositive,
    dailyWeightRows: days.length, dailyExactPositiveValues, dailyBlockedValues,
    clientsWithBothSources, sameValueSignalClients,
    noSameValueSignalClients: clientsWithBothSources - sameValueSignalClients,
    targetMappedMeasurements: 0, targetWrites: 0,
  };
}
