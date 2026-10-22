import type { ClientAccountingSnapshot } from "../features/accounting/public.ts";
import type { ClientHomeSummary, HomePackSummary } from "../features/clients/public.ts";

/** Owners' pure rules, injected so this projection stays type-only towards feature public APIs. */
export interface HomeSummaryRules {
  readonly formatKopeks: (kopeks: number) => string;
  readonly pricePerSessionKopeks: (totalKopeks: number, sessions: number) => number;
}

/** «Подходит к концу» threshold, taken from the build120 reference; not a new product rule. */
const LOW_CREDITS = 2;

/** Only packs usable today count; the ledger owner already derived each balance. */
export function packSummary(rules: HomeSummaryRules, snapshot: ClientAccountingSnapshot | null, today: string): HomePackSummary {
  if (snapshot === null) return { kind: "UNAVAILABLE" };
  if (snapshot.mode === "UNTRACKED") return { kind: "NOT_TRACKED", label: "Учёт тренировок не ведётся" };
  if (snapshot.mode === "EXTERNAL") return { kind: "NOT_TRACKED", label: "Учёт ведётся вне FitCoach" };
  if (snapshot.packs.length === 0) return { kind: "NO_PACK" };
  const selected = snapshot.preferredPackId === null ? undefined
    : snapshot.packs.find((row) => row.pack.id === snapshot.preferredPackId);
  const scoped = snapshot.preferredPackId === null ? snapshot.packs : selected === undefined ? [] : [selected];
  const usable = scoped.filter((row) => row.pack.expiresOn === null || row.pack.expiresOn >= today);
  const available = usable.reduce((sum, row) => sum + Math.max(row.available, 0), 0);
  const reserved = (selected === undefined ? usable : [selected]).reduce((sum, row) => sum + row.reserved, 0);
  const granted = (selected === undefined ? usable : [selected]).reduce((sum, row) => sum + row.pack.grantedCount, 0);
  // The pack that serves next: the nearest expiry, then the oldest (§22.1.2 order without the type split).
  const next = selected ?? usable.filter((row) => row.available > 0).sort((a, b) =>
    (a.pack.expiresOn ?? "9999-12-31").localeCompare(b.pack.expiresOn ?? "9999-12-31")
      || a.pack.createdAt.localeCompare(b.pack.createdAt))[0];
  const price = next !== undefined && next.pack.totalKopeks > 0
    ? rules.formatKopeks(rules.pricePerSessionKopeks(next.pack.totalKopeks, next.pack.grantedCount)) : null;
  return {
    kind: "TRACKED", available, granted, reserved,
    tone: available === 0 ? "empty" : available <= LOW_CREDITS ? "warning" : "active",
    pricePerSession: price, expiresOn: next?.pack.expiresOn ?? null,
    writeOffAvailable: next !== undefined && next.available > 0 && (next.pack.expiresOn === null || next.pack.expiresOn >= today),
    returnableDebitId: snapshot.returnableDebitId,
  };
}

/** Проекция фактов учёта; сбой источника остаётся «нет данных». */
export function buildClientHomeSummary(rules: HomeSummaryRules, accounting: ClientAccountingSnapshot | null,
  today: string): ClientHomeSummary {
  return { pack: packSummary(rules, accounting, today) };
}
