import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import type { LegacyPlansSource } from "./LegacyPlansSourceReader.ts";
import type { LegacyExecutionSource, ExecutionRaw as Raw } from "./LegacyExecutionSourceReader.ts";
import type { PlanDraftMapping } from "./LegacyPlansStage.ts";
import { executionJson, executionObject } from "./LegacyExecutionOccurrences.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";
import { NOTE_MAX } from "../../apps/mobile/src/features/training/execution/domain/ExecutionModel.ts";

function fail(code: string): never { throw new Error(`R04_ID_LEDGER_EXECUTION_CONTEXT_${code}`); }
const text = (v: unknown): string => typeof v === "string" && v.trim() ? v : fail("IDENTITY_INVALID");
const array = (v: unknown): readonly unknown[] => Array.isArray(v) ? v : fail("ARRAY_INVALID");
const data = (v: unknown): Raw => executionObject(executionJson(v));
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function isDeleted(v: unknown): boolean {
  if (v === null) return false;
  return isExplicitTimestamp(v) ? true : fail("LIFECYCLE_INVALID");
}
function note(container: Raw, field: string) {
  const present = Object.hasOwn(container, field), value = container[field];
  if (present && value !== null && typeof value !== "string") return fail("NOTE_INVALID");
  return { present, value: typeof value === "string" ? value : null };
}
interface ExerciseNote { readonly sourceKey: string; readonly deleted: boolean; readonly plan: PlanDraftMapping | null; readonly diaryNote: ReturnType<typeof note> | null }
function diary(workoutNote: ReturnType<typeof note> | null, exerciseNotes: readonly ExerciseNote[]) {
  const compatibility: string[] = [];
  if (workoutNote?.value) compatibility.push("D01_WORKOUT_NOTE_FIELD_REQUIRED");
  if ((workoutNote?.value?.length ?? 0) > NOTE_MAX || exerciseNotes.some((e) => (e.diaryNote?.value?.length ?? 0) > NOTE_MAX)) compatibility.push("D01_NOTE_LIMIT");
  return { workoutNote, exerciseNotes, compatibility };
}
interface SourceSet { readonly key: string; readonly raw: Raw; readonly segments: readonly Raw[] }
/** Reproduce the observed v2 card predicate only. This does not assert a manual
 * v3 outcome or round/store any source number. */
function complete(set: SourceSet): boolean {
  return Boolean(set.raw.completedAt ?? set.raw.completed_at)
    && set.segments.length >= ((set.raw.setKind ?? set.raw.set_kind) === "drop" ? 2 : 1)
    && set.segments.every((s) => typeof s.reps === "string" && s.reps.trim() !== "" && Number.isInteger(Number(s.reps.trim())) && Number(s.reps.trim()) > 0
      && typeof s.weight === "string" && s.weight.trim() !== "" && Number.isFinite(Number(s.weight.trim().replace(",", "."))) && Number(s.weight.trim().replace(",", ".")) >= 0);
}
export interface LegacyWorkoutContext {
  readonly sourceKey: string; readonly workoutKey: string; readonly client: string;
  readonly kind: "CURRENT" | "ARCHIVE" | "SESSION";
  readonly lifecycle: "ACTIVE" | "DELETED" | "TEMPLATE" | "OWNERSHIP_REVIEW";
  readonly plan: PlanDraftMapping | null; readonly raw: unknown;
  readonly diary: unknown; readonly state: unknown;
}

/** Physical workout views, including empty/notes-only views. Plan aliases have
 * already passed full source/target parity; no names/logical slots join views. */
export function composeLegacyWorkoutContexts(context: CandidateIdentityContext, plans: LegacyPlansSource, source: LegacyExecutionSource,
  clients: ReadonlyMap<string, string>, aliases: ReadonlyMap<string, PlanDraftMapping>): readonly LegacyWorkoutContext[] {
  if (plans.accountScope !== context.accountScope || source.accountScope !== context.accountScope) return fail("SCOPE_INVALID");
  const key = (table: string, id: string, path?: string) => JSON.stringify([context.accountScope, table, id, ...(path === undefined ? [] : [path])]);
  function index(rows: readonly Raw[], parent?: string) {
    const result = new Map<string, Raw>();
    for (const row of rows) { const id = text(row.id); if (result.has(id)) return fail("DUPLICATE_ID"); if (parent) text(row[parent]); result.set(id, row); }
    return result;
  }
  const workouts = index(plans.tables.training_workouts ?? []), programs = index(plans.tables.training_programs ?? []);
  const exercises = index(plans.tables.training_exercises ?? [], "workout_id"), sets = index(plans.tables.training_set_logs ?? [], "exercise_id");
  const byWorkout = new Map<string, Raw[]>(), byExercise = new Map<string, Raw[]>(), bySet = new Map<string, Raw[]>();
  const append = (map: Map<string, Raw[]>, id: string, row: Raw) => { const rows = map.get(id) ?? []; rows.push(row); map.set(id, rows); };
  for (const e of exercises.values()) { const id = text(e.workout_id); if (!workouts.has(id)) return fail("EXERCISE_PARENT_MISSING"); append(byWorkout, id, e); }
  for (const s of sets.values()) { const id = text(s.exercise_id); if (!exercises.has(id)) return fail("SET_PARENT_MISSING"); append(byExercise, id, s); }
  for (const s of source.tables.training_set_segments ?? []) if (!isDeleted(s.deleted_at)) append(bySet, text(s.set_log_id), s);
  const workoutKey = (client: string, id: string) => {
    if (workouts.has(id) && workouts.get(id)!.client_id !== client) return fail("FOREIGN_WORKOUT");
    return JSON.stringify([context.accountScope, client, "WORKOUT", id]);
  };
  const result: LegacyWorkoutContext[] = [], seen = new Set<string>();
  function bind(sourceKey: string, client: string, template = false): PlanDraftMapping | null {
    const plan = aliases.get(sourceKey) ?? null;
    if (plan && plan.clientId !== clients.get(client) && !(template && plan.clientId === null)) return fail("FOREIGN_PLAN");
    return plan;
  }
  function add(value: LegacyWorkoutContext) {
    if (!clients.has(value.client) || seen.has(value.sourceKey)) return fail("OWNER_OR_COVERAGE_INVALID");
    seen.add(value.sourceKey); result.push(value);
  }
  function state(raw: Raw, sourceSets: readonly SourceSet[] | null, uninterpreted = "CANONICAL_CACHE_NOT_WORKOUT_OUTCOME") {
    const stored = note(raw, "status"), count = sourceSets?.filter(complete).length ?? null, total = sourceSets?.length ?? null;
    const derived = total === null ? null : total > 0 && count === total ? "completed" : count! > 0 ? "in_progress" : "planned";
    const issues: string[] = [];
    if (stored.value && !["planned", "in_progress", "completed", "done"].includes(stored.value)) issues.push("SOURCE_STATUS_REQUIRES_REVIEW");
    if (stored.value && derived !== null && (stored.value === "done" ? "completed" : stored.value) !== derived) issues.push("STORED_AND_DERIVED_STATUS_DIFFER");
    return { stored, derived, completedSets: count, totalSets: total, sourceSetKeys: sourceSets?.map((s) => s.key).sort(compare) ?? [],
      basis: sourceSets === null ? uninterpreted : "LEGACY_SET_CARD_RULE", targetOutcome: null, issues };
  }
  for (const w of workouts.values()) {
    const id = text(w.id), client = text(w.client_id), p = w.program_id === null ? undefined : programs.get(text(w.program_id));
    if (p && p.client_id !== client) return fail("FOREIGN_PROGRAM");
    const deleted = isDeleted(w.deleted_at) || p !== undefined && isDeleted(p.deleted_at), template = p?.is_template === 1;
    const sourceKey = key("training_workouts", id), children = (byWorkout.get(id) ?? []).sort((a, b) => compare(text(a.id), text(b.id)));
    const sourceSets: SourceSet[] = [];
    for (const e of children) if (!isDeleted(e.deleted_at)) for (const s of byExercise.get(text(e.id)) ?? []) if (!isDeleted(s.deleted_at)) {
      const segments = (bySet.get(text(s.id)) ?? []).sort((a, b) => Number(a.segment_index) - Number(b.segment_index));
      sourceSets.push({ key: key("training_set_logs", text(s.id)), raw: s, segments: segments.length ? segments : [{ reps: s.reps, weight: s.weight }] });
    }
    const exerciseNotes = children.map((e) => ({ sourceKey: key("training_exercises", text(e.id)), deleted: isDeleted(e.deleted_at),
      plan: bind(key("training_exercises", text(e.id)), client, template),
      diaryNote: deleted || isDeleted(e.deleted_at) ? null : note(data(e.data_json), "diaryNote") }));
    add({ sourceKey, workoutKey: workoutKey(client, id), client, kind: "CURRENT", lifecycle: deleted ? "DELETED" : template ? "TEMPLATE" : "ACTIVE",
      plan: bind(sourceKey, client, template), raw: { workout: w, exercises: children },
      diary: diary(deleted ? null : note(data(w.data_json), "note"), exerciseNotes), state: state(w, deleted ? null : sourceSets, "DELETED_VIEW_NOT_INTERPRETED") });
  }
  for (const entry of plans.tables.training_archive_entries ?? []) {
    if (isDeleted(entry.deleted_at)) continue;
    const archive = text(entry.id), client = text(entry.client_id), root = data(entry.data_json), cycles = root.cycles == null ? [] : array(root.cycles);
    const pages = cycles.length ? cycles.map((c, i) => ({ page: executionObject(executionObject(c).snapshot), path: `/cycles/${i}/snapshot` })) : [{ page: root, path: "" }];
    let offset = 0;
    for (const { page, path } of pages) {
      const program = programs.get(text(page.programId)), foreign = program !== undefined && program.client_id !== client;
      const pageWorkouts = array(page.workouts);
      for (const [wi, raw] of pageWorkouts.entries()) {
        const w = executionObject(raw), wp = `${path}/workouts/${wi}`, sourceKey = key("training_archive_entries", archive, wp), plan = bind(sourceKey, client);
        const mirrorKey = cycles.length ? key("training_archive_entries", archive, `/workouts/${wi + offset}`) : null;
        if (mirrorKey !== null && (!plan?.targetId || bind(mirrorKey, client)?.targetId !== plan.targetId)) return fail("MIRROR_BINDING_MISSING");
        const sourceSets: SourceSet[] = [], exerciseNotes = array(w.exercises).map((raw, ei) => {
          const e = executionObject(raw), ep = `${wp}/exercises/${ei}`;
          for (const [si, rawSet] of array(e.sets).entries()) {
            const s = executionObject(rawSet), rawSegments = s.segments == null ? [] : array(s.segments).map(executionObject);
            sourceSets.push({ key: key("training_archive_entries", archive, `${ep}/sets/${si}`), raw: s,
              segments: rawSegments.length ? rawSegments : [{ reps: s.reps, weight: s.weight }] });
          }
          return { sourceKey: key("training_archive_entries", archive, ep), deleted: false, plan: bind(key("training_archive_entries", archive, ep), client),
            diaryNote: note(executionObject(e.data), "diaryNote") };
        });
        add({ sourceKey, workoutKey: key("archive-workout", archive, wp), client, kind: "ARCHIVE", lifecycle: foreign ? "OWNERSHIP_REVIEW" : "ACTIVE", plan,
          raw: { workout: w, mirror: mirrorKey === null ? null : { sourceKey: mirrorKey, workout: array(root.workouts)[wi + offset] } },
          diary: diary(note(w.data === undefined ? {} : executionObject(w.data), "note"), exerciseNotes), state: state(w, sourceSets) });
      }
      offset += pageWorkouts.length;
    }
  }
  for (const s of source.tables.training_sessions ?? []) {
    const client = text(s.client_id), id = text(s.id), sourceId = typeof s.source_workout_id === "string" && s.source_workout_id.trim() ? s.source_workout_id : null;
    add({ sourceKey: key("training_sessions", id), workoutKey: sourceId === null ? key("training_sessions", id) : workoutKey(client, sourceId), client, kind: "SESSION",
      lifecycle: isDeleted(s.deleted_at) ? "DELETED" : "ACTIVE", plan: sourceId === null ? null : bind(key("training_workouts", sourceId), client), raw: s,
      diary: diary(null, []), state: state(s, null) });
  }
  return result.sort((a, b) => compare(a.sourceKey, b.sourceKey));
}
