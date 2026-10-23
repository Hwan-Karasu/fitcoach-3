import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyPlansSource } from "./LegacyPlansSourceReader.ts";
import type { LegacyExecutionSource, ExecutionRaw as Raw } from "./LegacyExecutionSourceReader.ts";
import type { PlanDraftMapping } from "./LegacyPlansStage.ts";
import { legacyExecutionDate, type LegacyExecutionDate } from "./LegacyExecutionDates.ts";
import { convertLegacySetMetrics } from "./LegacySetMetricCandidates.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";

function fail(code: string): never { throw new Error(`R04_ID_LEDGER_EXECUTION_${code}`); }
export function executionObject(value: unknown): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("OBJECT_INVALID"); return value as Raw;
}
export function executionJson(value: unknown): unknown {
  if (typeof value !== "string") return fail("JSON_INVALID"); try { return JSON.parse(value) as unknown; } catch { return fail("JSON_INVALID"); }
}
function objectJson(value: unknown): Raw { return executionObject(executionJson(value)); }
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) return fail("IDENTITY_INVALID"); return value; }
function array(value: unknown): readonly unknown[] { if (!Array.isArray(value)) return fail("ARRAY_INVALID"); return value; }
function deleted(value: unknown): boolean { if (value === null) return false; if (!isExplicitTimestamp(value)) return fail("LIFECYCLE_INVALID"); return true; }
function index(rows: readonly Raw[]): Map<string, Raw> {
  const result = new Map<string, Raw>(); for (const row of rows) { const id = text(row.id); if (result.has(id)) return fail("DUPLICATE_SOURCE_ID"); result.set(id, row); } return result;
}
export interface ExecutionSegment { readonly reps: number; readonly loadGrams: number }
export interface ExecutionOccurrence {
  readonly sourceKey: string; readonly kind: "CURRENT" | "SESSION" | "HISTORY" | "ARCHIVE";
  readonly client: string; readonly factKey: string; readonly sourceFactId: string | null; readonly workoutKey: string;
  readonly disposition: "PERFORMED" | "UNCONFIRMED" | "DELETED" | "TEMPLATE";
  readonly exerciseId: string | null; readonly name: string | null; readonly position: number;
  readonly type: "NORMAL" | "WARMUP" | "DROP" | "FAILURE"; readonly effort: "normal" | "failure";
  readonly segments: readonly ExecutionSegment[]; readonly rpe: number | null; readonly date: LegacyExecutionDate;
  readonly completionBasis: string; readonly plan: PlanDraftMapping | null; readonly raw: unknown;
  readonly ownership: "CLIENT_BOUND" | "ARCHIVE_FOREIGN_PROGRAM";
}
interface Input {
  readonly sourceKey: string; readonly client: string; readonly kind: ExecutionOccurrence["kind"]; readonly factRefs: readonly unknown[];
  readonly workoutKey: string; readonly row: Raw; readonly data: Raw; readonly deleted: boolean; readonly template?: boolean;
  readonly catalogRefs: readonly unknown[]; readonly name: unknown; readonly position: unknown; readonly segments: unknown;
  readonly completedAt: unknown; readonly reps: unknown; readonly weight: unknown; readonly rpe: unknown; readonly setKind: unknown; readonly effort: unknown;
  readonly status?: unknown; readonly dateSource?: unknown; readonly dateValue?: unknown; readonly importedAt?: unknown; readonly forceDay?: boolean;
  readonly fallbackKey?: string; readonly planKey?: string;
  readonly foreignArchiveProgram?: boolean;
}

/** All stores are reparsed from the frozen source, not preflight dispositions.
 * Metrics are compared after exact conversion; names/dates/weights never identify a fact. */
export function composeLegacyExecutionOccurrences(context: CandidateIdentityContext, plans: LegacyPlansSource, source: LegacyExecutionSource,
  clients: ReadonlyMap<string, string>, catalog: ReadonlyMap<string, string>, aliases: ReadonlyMap<string, PlanDraftMapping>) {
  if (plans.accountScope !== context.accountScope || source.accountScope !== context.accountScope) return fail("SCOPE_MISMATCH");
  const scope = context.accountScope, result: ExecutionOccurrence[] = [], seen = new Set<string>();
  const p = (table: keyof LegacyPlansSource["tables"]) => plans.tables[table] ?? [];
  const e = (table: keyof LegacyExecutionSource["tables"]) => source.tables[table] ?? [];
  const key = (table: string, id: string, path?: string) => JSON.stringify([scope, table, id, ...(path === undefined ? [] : [path])]);
  const workouts = index(p("training_workouts")), exercises = index(p("training_exercises")), programs = index(p("training_programs"));
  const workoutKey = (client: string, id: string) => {
    const existing = workouts.get(id); if (existing && existing.client_id !== client) return fail("FOREIGN_WORKOUT_REFERENCE");
    return JSON.stringify([scope, client, "WORKOUT", id]);
  };
  const instanceRefs = (value: unknown, client: string): readonly unknown[] => {
    if (value == null || value === "") return [];
    const id = text(value); if (catalog.has(id)) return [id];
    const ex = exercises.get(id); if (!ex) return [];
    const w = workouts.get(text(ex.workout_id)); if (!w || w.client_id !== client) return fail("FOREIGN_EXERCISE_REFERENCE");
    return [ex.template_exercise_id, objectJson(ex.data_json).catalogId];
  };
  const explicitRefs = (refs: readonly unknown[]) => refs.filter((v) => v !== undefined && v !== null && v !== "").map(text);
  function append(input: Input) {
    if (!clients.has(input.client) || seen.has(input.sourceKey)) return fail("OWNER_OR_COVERAGE_INVALID"); seen.add(input.sourceKey);
    const ids = explicitRefs(input.factRefs); if (new Set(ids).size > 1) return fail("FACT_ID_CONFLICT");
    const sourceFactId = ids[0] ?? null, factKey = JSON.stringify([scope, input.client, sourceFactId === null ? "PHYSICAL" : "EXPLICIT", sourceFactId ?? input.fallbackKey ?? input.sourceKey]);
    const disposition = input.template ? "TEMPLATE" : input.deleted ? "DELETED" : input.kind === "HISTORY" || input.kind === "SESSION" || input.completedAt != null && input.completedAt !== ""
      ? "PERFORMED" : "UNCONFIRMED";
    const type = input.setKind === "drop" ? "DROP" : input.setKind === "warmup" ? "WARMUP" : input.effort === "failure" ? "FAILURE" : "NORMAL";
    let completion: ExecutionOccurrence["disposition"] = disposition;
    let basis: string = disposition === "PERFORMED" ? input.kind === "HISTORY" ? "PERSISTED_COMPLETED_HISTORY" : input.kind === "SESSION" ? "PERSISTED_SESSION_PROJECTION" : "COMPLETION_MARKER" : disposition;
    const metrics = convertLegacySetMetrics(input.reps, input.weight);
    const implicit = input.data.factCompletionExplicit !== true && input.data.factCompletionExplicit !== 1
      && !Object.hasOwn(input.data, "plannedReps") && !Object.hasOwn(input.data, "plannedWeight");
    const implicitSegments = input.segments == null ? [] : array(input.segments);
    const implicitValues = (implicitSegments.length ? implicitSegments : [{ reps: input.reps, weight: input.weight }]);
    const implicitComplete = (type === "DROP" ? implicitValues.length >= 2 : implicitValues.length === 1)
      && implicitValues.every((s) => { const v = executionObject(s); return convertLegacySetMetrics(v.reps, v.weight).metricIssues.length === 0; });
    if (completion === "UNCONFIRMED" && implicit && metrics.metricIssues.length === 0 && implicitComplete) { completion = "PERFORMED"; basis = "LEGACY_IMPLICIT_COMPLETION"; }
    const base = { sourceKey: input.sourceKey, kind: input.kind, client: input.client, factKey, sourceFactId, workoutKey: input.workoutKey,
      disposition: completion, exerciseId: null, name: typeof input.name === "string" ? input.name : null,
      position: typeof input.position === "number" && Number.isSafeInteger(input.position) && input.position >= 0 ? input.position : 0,
      type, effort: input.effort === "failure" ? "failure" as const : "normal" as const,
      segments: [] as ExecutionSegment[], rpe: null, date: legacyExecutionDate(null, undefined, undefined, undefined), completionBasis: basis,
      ownership: input.foreignArchiveProgram ? "ARCHIVE_FOREIGN_PROGRAM" : "CLIENT_BOUND",
      plan: input.planKey === undefined ? null : aliases.get(input.planKey) ?? null, raw: input.row } satisfies ExecutionOccurrence;
    if (completion !== "PERFORMED") { result.push(base); return; }
    if (typeof input.position !== "number" || !Number.isSafeInteger(input.position) || input.position < 0) return fail("SET_POSITION_INVALID");
    if (input.setKind != null && !["working", "warmup", "drop"].includes(String(input.setKind))
      || input.effort != null && !["normal", "failure"].includes(String(input.effort))) return fail("SET_TYPE_INVALID");
    const refs = explicitRefs(input.catalogRefs); if (!refs.length || new Set(refs).size !== 1 || !catalog.has(refs[0]!)) return fail("EXERCISE_REFERENCE_UNRESOLVED");
    const segmentRows = input.segments === undefined || input.segments === null ? [] : array(input.segments);
    const values = (segmentRows.length ? segmentRows : [{ reps: input.reps, weight: input.weight }]).map((s) => {
      const raw = executionObject(s), value = convertLegacySetMetrics(raw.reps, raw.weight);
      if (value.metricIssues.length || value.values.reps === null || value.values.loadGrams === null) return fail("METRICS_INVALID");
      return { reps: value.values.reps, loadGrams: value.values.loadGrams };
    });
    if (type === "DROP" && values.length < 2 || type !== "DROP" && values.length !== 1) return fail("SEGMENTS_INVALID");
    if (metrics.metricIssues.length || metrics.values.reps !== values[0]!.reps || metrics.values.loadGrams !== values[0]!.loadGrams) return fail("BASE_SEGMENT_CONFLICT");
    const rpe = input.rpe == null || input.rpe === "" ? null : typeof input.rpe === "string" && /^\d+$/u.test(input.rpe.trim()) ? Number(input.rpe.trim()) : NaN;
    if (rpe !== null && (!Number.isInteger(rpe) || rpe < 1 || rpe > 10)) return fail("RPE_INVALID");
    result.push({ ...base, exerciseId: catalog.get(refs[0]!)!, name: typeof input.name === "string" ? input.name : null, segments: values, rpe,
      date: legacyExecutionDate(input.dateValue ?? input.completedAt, input.status, input.dateSource, input.importedAt, input.forceDay) });
  }
  const segments = new Map<string, Raw[]>();
  index(e("training_set_segments"));
  for (const row of e("training_set_segments")) {
    const id = text(row.set_log_id), rows = segments.get(id) ?? []; rows.push(row); segments.set(id, rows);
  }
  const currentSets = index(p("training_set_logs"));
  for (const row of e("training_set_segments")) if (!currentSets.has(text(row.set_log_id))) return fail("ORPHAN_SEGMENT");
  for (const row of currentSets.values()) {
    const ex = exercises.get(text(row.exercise_id)), w = ex && workouts.get(text(ex.workout_id)); if (!ex || !w) return fail("CURRENT_PARENT_MISSING");
    const program = w.program_id === null ? undefined : programs.get(text(w.program_id)), data = objectJson(row.data_json), exData = objectJson(ex.data_json), client = text(w.client_id);
    const activeSegments = (segments.get(text(row.id)) ?? []).filter((s) => !deleted(s.deleted_at)).sort((a, b) => Number(a.segment_index) - Number(b.segment_index));
    if (activeSegments.some((s) => typeof s.segment_index !== "number" || !Number.isSafeInteger(s.segment_index) || s.segment_index < 0)
      || new Set(activeSegments.map((s) => s.segment_index)).size !== activeSegments.length) return fail("SEGMENT_ORDER_INVALID");
    append({ sourceKey: key("training_set_logs", text(row.id)), kind: "CURRENT", client, factRefs: [data.historyOriginId == null || data.historyOriginId === "" ? row.id : data.historyOriginId], workoutKey: workoutKey(client, text(w.id)), row, data,
      deleted: deleted(row.deleted_at) || deleted(ex.deleted_at) || deleted(w.deleted_at) || program !== undefined && deleted(program.deleted_at), template: program?.is_template === 1,
      catalogRefs: [ex.template_exercise_id, exData.catalogId], name: ex.name, position: row.set_index, segments: activeSegments,
      completedAt: row.completed_at, reps: row.reps, weight: row.weight, rpe: row.rpe, setKind: row.set_kind, effort: row.effort_outcome,
      status: data.historyDateStatus, importedAt: data.historyImportedAt, forceDay: data.historyDateStatus === "exact", planKey: key("training_set_logs", text(row.id)) });
  }
  const sessions = index(e("training_sessions")), sessionExercises = index(e("training_session_exercises")); index(e("training_session_sets"));
  for (const ex of sessionExercises.values()) if (!sessions.has(text(ex.session_id))) return fail("SESSION_PARENT_MISSING");
  for (const row of e("training_session_sets")) {
    const ex = sessionExercises.get(text(row.session_exercise_id)), s = ex && sessions.get(text(ex.session_id)); if (!ex || !s) return fail("SESSION_PARENT_MISSING");
    const client = text(s.client_id), data = objectJson(row.data_json), meta = objectJson(s.data_json), instance = typeof ex.source_exercise_id === "string" ? exercises.get(ex.source_exercise_id) : undefined;
    const iw = instance && workouts.get(text(instance.workout_id)); if (iw && iw.client_id !== client) return fail("FOREIGN_EXERCISE_REFERENCE");
    const refs = [ex.catalog_id, typeof ex.exercise_key === "string" && ex.exercise_key.startsWith("catalog:") ? ex.exercise_key.slice(8) : null,
      ...instanceRefs(ex.source_exercise_id, client)];
    append({ sourceKey: key("training_session_sets", text(row.id)), kind: "SESSION", client, factRefs: [row.source_fact_id],
      workoutKey: typeof s.source_workout_id === "string" && s.source_workout_id.trim() ? workoutKey(client, s.source_workout_id) : key("training_sessions", text(s.id)),
      row, data, deleted: deleted(row.deleted_at) || deleted(ex.deleted_at) || deleted(s.deleted_at), catalogRefs: refs, name: ex.name,
      position: row.set_index, segments: executionJson(row.segments_json), completedAt: row.completed_at, reps: row.reps, weight: row.weight, rpe: row.rpe,
      setKind: row.set_kind, effort: row.effort_outcome, status: meta.dateStatus, importedAt: meta.importedAt, dateSource: s.date_source,
      dateValue: s.date_source === "explicit" ? s.performed_at : row.completed_at });
  }
  index(e("training_exercise_history"));
  for (const row of e("training_exercise_history")) {
    const data = objectJson(row.data_json), client = text(row.client_id), id = text(row.id);
    const explicit = [row.source_fact_id, data.sourceFactId].some((v) => v != null && v !== "");
    append({ sourceKey: key("training_exercise_history", id), kind: "HISTORY", client, factRefs: explicit ? [row.source_fact_id, data.sourceFactId] : [data.id],
      fallbackKey: typeof data.id === "string" && data.id.trim() ? key("history-record", data.id) : undefined,
      workoutKey: typeof data.workoutId === "string" && data.workoutId.trim() ? workoutKey(client, data.workoutId) : key("history-workout", id),
      row, data, deleted: deleted(row.deleted_at), catalogRefs: [data.catalogId, typeof row.exercise_key === "string" && row.exercise_key.startsWith("catalog:") ? row.exercise_key.slice(8) : catalog.has(String(row.exercise_key)) ? row.exercise_key : null,
        ...instanceRefs(data.exerciseId, client)],
      name: data.name, position: data.setIndex, segments: data.segments, completedAt: data.date, reps: data.reps, weight: data.weight, rpe: data.rpe,
      setKind: data.setKind, effort: data.effortOutcome, status: data.dateStatus, dateSource: data.dateSource, importedAt: data.importedAt });
  }
  for (const row of p("training_archive_entries")) {
    if (deleted(row.deleted_at)) continue;
    const root = objectJson(row.data_json), cycles = root.cycles == null ? [] : array(root.cycles), client = text(row.client_id), archive = text(row.id);
    let workoutOffset = 0;
    const pages = cycles.length ? cycles.map((c, i) => ({ value: executionObject(executionObject(c).snapshot), path: `/cycles/${i}/snapshot` })) : [{ value: root, path: "" }];
    for (const page of pages) {
      const sourceProgram = programs.get(text(page.value.programId));
      const foreignProgram = sourceProgram !== undefined && sourceProgram.client_id !== client;
      array(page.value.workouts).forEach((workoutRaw, wi) => {
        const w = executionObject(workoutRaw), wp = `${page.path}/workouts/${wi}`;
        array(w.exercises).forEach((exerciseRaw, ei) => {
          const ex = executionObject(exerciseRaw), exData = executionObject(ex.data);
          array(ex.sets).forEach((setRaw, si) => {
            const set = executionObject(setRaw), data = executionObject(set.data), path = `${wp}/exercises/${ei}/sets/${si}`, canonicalKey = key("training_archive_entries", archive, path);
            const input: Input = { sourceKey: canonicalKey, kind: "ARCHIVE", client, factRefs: [set.sourceFactId, data.historyOriginId],
              workoutKey: key("archive-workout", archive, wp), row: set, data, deleted: false, fallbackKey: canonicalKey,
              catalogRefs: [ex.templateExerciseId, exData.catalogId], name: ex.name, position: set.setIndex, segments: set.segments,
              completedAt: set.completedAt, reps: set.reps, weight: set.weight, rpe: set.rpe, setKind: set.setKind, effort: set.effortOutcome,
              status: data.historyDateStatus, importedAt: data.historyImportedAt, forceDay: data.historyDateStatus === "exact", planKey: canonicalKey };
            const ownedInput = { ...input, foreignArchiveProgram: foreignProgram };
            append(ownedInput);
            if (cycles.length) { const rootPath = `/workouts/${wi + workoutOffset}/exercises/${ei}/sets/${si}`; append({ ...ownedInput, sourceKey: key("training_archive_entries", archive, rootPath), planKey: key("training_archive_entries", archive, rootPath) }); }
          });
        });
      });
      workoutOffset += array(page.value.workouts).length;
    }
  }
  return result.sort((a, b) => a.sourceKey < b.sourceKey ? -1 : a.sourceKey > b.sourceKey ? 1 : 0);
}
