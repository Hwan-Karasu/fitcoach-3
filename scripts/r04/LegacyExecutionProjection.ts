import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { ExecutionOccurrence } from "./LegacyExecutionOccurrences.ts";
import { mergeLegacyExecutionDates } from "./LegacyExecutionDates.ts";
import type { PlanRow } from "./LegacyPlansProjection.ts";
import type { LegacyWorkoutContext } from "./LegacyWorkoutContexts.ts";

export const EXECUTION_TARGET_TABLES = ["r04_execution_sessions", "r04_execution_facts", "r04_execution_segments", "r04_execution_representations", "r04_execution_contexts"] as const;
export type ExecutionIdentityKind = "SESSION" | "FACT" | "CONTEXT";
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const rank = { HISTORY: 0, SESSION: 1, ARCHIVE: 2, CURRENT: 3 } as const;
function fail(code: string): never { throw new Error(`R04_ID_LEDGER_EXECUTION_${code}`); }
/** One fact per account/client/explicit source identity; only proven shared fact
 * identity or a physical source-workout reference joins workout representations. */
export function composeLegacyExecutions(context: CandidateIdentityContext, importedAt: string, occurrences: readonly ExecutionOccurrence[],
  clients: ReadonlyMap<string, string>, identity: (kind: ExecutionIdentityKind, key: string) => string, contexts: readonly LegacyWorkoutContext[]) {
  const groups = new Map<string, ExecutionOccurrence[]>(), seen = new Set<string>(), parents = new Map<string, string>();
  for (const row of occurrences) {
    if (seen.has(row.sourceKey) || !clients.has(row.client)) return fail("COVERAGE_INVALID"); seen.add(row.sourceKey);
    const rows = groups.get(row.factKey) ?? []; rows.push(row); groups.set(row.factKey, rows);
  }
  function root(key: string): string {
    const path: string[] = []; let current = key;
    while (parents.has(current) && parents.get(current) !== current) { path.push(current); current = parents.get(current)!; }
    if (!parents.has(current)) parents.set(current, current);
    for (const node of path) parents.set(node, current); return current;
  }
  function unite(a: string, b: string) { const x = root(a), y = root(b); if (x !== y) parents.set(compare(x, y) < 0 ? y : x, compare(x, y) < 0 ? x : y); }
  const active = new Map<string, readonly ExecutionOccurrence[]>(), accepted = new Set<string>();
  for (const [key, rows] of groups) {
    const corroborated = rows.some((r) => r.disposition === "PERFORMED" && r.kind !== "ARCHIVE" && r.ownership === "CLIENT_BOUND");
    const performed = rows.filter((r) => r.disposition === "PERFORMED" && (r.ownership === "CLIENT_BOUND" || corroborated))
      .sort((a, b) => rank[a.kind] - rank[b.kind] || compare(a.sourceKey, b.sourceKey));
    if (!performed.length) continue;
    if (rows.some((r) => r.kind === "CURRENT" && r.disposition === "UNCONFIRMED")) return fail("CURRENT_CONFIRMATION_CONFLICT");
    if (new Set(performed.map((r) => JSON.stringify([r.exerciseId, r.type, r.effort, r.segments]))).size !== 1
      || new Set(performed.filter((r) => r.rpe !== null).map((r) => r.rpe)).size > 1) return fail("FACT_VALUE_CONFLICT");
    active.set(key, performed); for (const row of performed) { accepted.add(row.sourceKey); unite(performed[0]!.workoutKey, row.workoutKey); }
  }
  const tables = Object.fromEntries(EXECUTION_TARGET_TABLES.map((t) => [t, [] as PlanRow[]])) as Record<typeof EXECUTION_TARGET_TABLES[number], PlanRow[]>;
  const factIds = new Map<string, string>(), sessionIds = new Map<string, string>();
  const sessionFacts = new Map<string, PlanRow[]>(), sessionSources = new Map<string, Set<string>>();
  for (const [key, rows] of [...active].sort(([a], [b]) => compare(a, b))) {
    const first = rows[0]!, node = root(first.workoutKey), client = clients.get(first.client)!;
    const id = identity("FACT", key), sessionKey = JSON.stringify([context.accountScope, first.client, "CONNECTED_WORKOUT", node]);
    const sessionId = sessionIds.get(node) ?? identity("SESSION", sessionKey); sessionIds.set(node, sessionId); factIds.set(key, id);
    const date = mergeLegacyExecutionDates(rows.map((r) => r.date)), values = first.segments[0]!, compatibility: string[] = [];
    const named = rows.find((r) => r.name !== null && r.name.trim());
    if (date.actualDate === null) compatibility.push("D01_REQUIRES_KNOWN_DATE");
    if (groups.get(key)!.some((r) => r.disposition === "DELETED")) compatibility.push("DELETION_EVIDENCE_REQUIRES_REVIEW");
    if (date.precision === "INSTANT") compatibility.push("INSTANT_DAY_TIMEZONE_POLICY_REQUIRED");
    if (date.precision === "LOCAL_DATETIME") compatibility.push("LOCAL_TIME_HAS_NO_OFFSET");
    if (first.sourceFactId === null) compatibility.push("NO_EXPLICIT_SOURCE_FACT_ID");
    if (rows.every((r) => r.plan === null || r.plan.programId === null)) compatibility.push("D01_PLAN_CONTEXT_REQUIRED");
    if (first.segments.length > 10) compatibility.push("D01_DROP_LIMIT");
    if (first.segments.some((s) => s.reps > 999 || s.loadGrams > 1000000)) compatibility.push("D01_METRIC_LIMIT");
    if (first.type === "DROP" && first.effort === "failure") compatibility.push("D01_DROP_FAILURE_FIELD_REQUIRED");
    if (first.type === "WARMUP" && first.effort === "failure") compatibility.push("D01_WARMUP_FAILURE_FIELD_REQUIRED");
    if (!named) compatibility.push("SNAPSHOT_NAME_NOT_OBSERVED");
    const fact: PlanRow = { id, workspace_id: context.targetWorkspaceId, client_id: client, session_id: sessionId, source_identity_key: key,
      source_fact_id: first.sourceFactId, exercise_id: first.exerciseId!, snapshot_name: named?.name ?? null, snapshot_name_basis: named?.sourceKey ?? first.sourceKey,
      names_json: JSON.stringify([...new Set(rows.map((r) => r.name))].sort()), set_type: first.type, effort_outcome: first.effort,
      reps: values.reps, load_grams: values.loadGrams, rpe: rows.find((r) => r.rpe !== null)?.rpe ?? null,
      date_precision: date.precision, actual_date: date.actualDate, actual_timestamp: date.timestamp, estimated_date: date.estimatedDate,
      imported_at: date.importedAt, completion_basis_json: JSON.stringify([...new Set(rows.map((r) => r.completionBasis))].sort()),
      compatibility_json: JSON.stringify(compatibility.sort()), revision: 1, created_at: importedAt };
    tables.r04_execution_facts.push(fact);
    first.segments.forEach((s, position) => tables.r04_execution_segments.push({ workspace_id: context.targetWorkspaceId, fact_id: id, position, reps: s.reps, load_grams: s.loadGrams }));
    const facts = sessionFacts.get(node) ?? []; facts.push(fact); sessionFacts.set(node, facts);
    const sources = sessionSources.get(node) ?? new Set<string>(); for (const r of rows) sources.add(r.workoutKey); sessionSources.set(node, sources);
  }
  for (const [node, facts] of [...sessionFacts].sort(([a], [b]) => compare(a, b))) {
    const dates = facts.map((f) => f.actual_date).filter((d): d is string => typeof d === "string").sort(compare);
    if (new Set(facts.map((f) => f.client_id)).size !== 1) return fail("SESSION_OWNER_CONFLICT");
    tables.r04_execution_sessions.push({ id: sessionIds.get(node)!, workspace_id: context.targetWorkspaceId, client_id: facts[0]!.client_id!,
      first_known_date: dates[0] ?? null, last_known_date: dates.at(-1) ?? null, undated_facts: facts.filter((f) => f.actual_date === null).length,
      working_facts: facts.filter((f) => f.set_type !== "WARMUP").length, source_workouts_json: JSON.stringify([...sessionSources.get(node)!].sort(compare)), created_at: importedAt });
  }
  for (const row of occurrences) {
    const review = row.disposition === "PERFORMED" && row.ownership === "ARCHIVE_FOREIGN_PROGRAM" && !accepted.has(row.sourceKey);
    const id = review ? null : factIds.get(row.factKey) ?? null, positive = review ? undefined : active.get(row.factKey)?.[0], session = positive ? sessionIds.get(root(positive.workoutKey))! : null;
    const disposition = review ? "OWNERSHIP_REVIEW" : row.disposition;
    tables.r04_execution_representations.push({ source_key: row.sourceKey, workspace_id: context.targetWorkspaceId, client_id: clients.get(row.client)!,
      fact_id: id, session_id: session, source_kind: row.kind, disposition, source_json: JSON.stringify(row.raw),
      context_json: JSON.stringify({ workoutKey: row.workoutKey, sourceFactId: row.sourceFactId, plan: row.plan, snapshotName: row.name, position: row.position, completionBasis: row.completionBasis, ownership: row.ownership,
        editable: row.editable }),
      date_json: JSON.stringify(row.date) });
  }
  const sourceSessions = new Map<string, string>();
  for (const [node, keys] of sessionSources) for (const key of keys) sourceSessions.set(key, sessionIds.get(node)!);
  for (const row of contexts) {
    const client = clients.get(row.client); if (!client) return fail("CONTEXT_OWNER_INVALID");
    tables.r04_execution_contexts.push({ id: identity("CONTEXT", row.sourceKey), source_key: row.sourceKey, workspace_id: context.targetWorkspaceId,
      client_id: client, session_id: row.lifecycle === "ACTIVE" || row.lifecycle === "DELETED" ? sourceSessions.get(row.workoutKey) ?? null : null,
      source_kind: row.kind, lifecycle: row.lifecycle, source_workout_key: row.workoutKey,
      plan_json: JSON.stringify(row.plan), source_json: JSON.stringify(row.raw), diary_json: JSON.stringify(row.diary), state_json: JSON.stringify(row.state) });
  }
  return { tables, performedFacts: tables.r04_execution_facts.length, canonicalSessions: tables.r04_execution_sessions.length,
    executionContexts: tables.r04_execution_contexts.length,
    retainedRepresentations: tables.r04_execution_representations.filter((r) => r.disposition !== "PERFORMED").length,
    incompatibleFacts: tables.r04_execution_facts.filter((r) => r.compatibility_json !== "[]").length, finalizable: false as const };
}
