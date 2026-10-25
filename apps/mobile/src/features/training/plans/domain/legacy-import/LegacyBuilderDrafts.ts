import type { CandidateIdentityContext } from "../../../../../shared/migration/LegacyIdentityBinding.ts";
import type { LegacySettingsSource } from "../../../../../shared/migration/LegacySettingsSource.ts";
import type { LegacyPlansSource } from "../../../../../shared/migration/LegacyPlanSources.ts";
import type { LegacySourceRow } from "../../../../../shared/migration/LegacyProfileSources.ts";
import { parseRoundTripSourceJson } from "../../../../../shared/migration/SourceJson.ts";
import { projectLegacyPlanPrescription, sourcePlanRange } from "./LegacyPlanPrescription.ts";
import type { PlanIdentityKind, PlanRow } from "./LegacyPlansProjection.ts";
import type { PlannedExercise, PlannedSet, PlannedWorkout, SimpleProgramDraft } from "../SimplePlanModel.ts";
import { storedBuilderDraft, storedMesocycleBuilder } from "../StoredPlanShape.ts";
import type { BuilderWeek, WeekType, CycleType } from "../PeriodizedModel.ts";

type Raw = Readonly<Record<string, unknown>>;
export interface LegacyBuilderDraftInput {
  readonly settings: LegacySettingsSource;
  readonly facts: { readonly accountScope: string; readonly segments: readonly LegacySourceRow[] | null };
}
type Ref = { readonly kind: PlanIdentityKind; readonly key: string; readonly existing: string | null };
interface Exercise { readonly ref: Ref; readonly catalog: string; readonly rir: PlannedExercise["rir"]; readonly superset: Ref | null;
  readonly sets: readonly { ref: Ref; values: Omit<PlannedSet, "id"> }[]; readonly lineage: string | null; readonly restSec: number | null; readonly instruction: string | null }
interface Workout { readonly ref: Ref; readonly title: string; readonly exercises: readonly Exercise[]; readonly lineage: string | null }
interface Prepared { readonly raw: Raw; readonly sourceKey: string; readonly client: string; readonly sourceClient: string; readonly kind: "simple" | "periodized";
  readonly nativeKey: string; readonly scopeKey: string; readonly scoped: boolean; readonly program: PlanRow | null; readonly cycle: PlanRow | null;
  readonly draft: Raw; readonly workouts: readonly Workout[]; readonly weeks: readonly { type: WeekType; workouts: readonly Workout[] }[]; readonly members: readonly string[] }
const fail = (reason: string): never => { throw new Error(`R04_ID_LEDGER_BUILDER_${reason}`); };
const object = (v: unknown): Raw => { if (!v || typeof v !== "object" || Array.isArray(v)) return fail("OBJECT_INVALID"); return v as Raw; };
const text = (v: unknown): string => { if (typeof v !== "string") return fail("TEXT_INVALID"); return v; };
const id = (v: unknown): string => { const s = text(v); if (!s.trim()) return fail("IDENTITY_INVALID"); return s; };
const array = (v: unknown): readonly unknown[] => { if (!Array.isArray(v)) return fail("ARRAY_INVALID"); return v; };
const integer = (v: unknown, min: number, max: number): number => { if (typeof v !== "number" || !Number.isSafeInteger(v) || v < min || v > max) return fail("NUMBER_INVALID"); return v; };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const fields = (row: Raw, names: readonly string[]) => { if (Object.keys(row).some((k) => !names.includes(k))) return fail("UNSUPPORTED_FIELDS"); };
const prefix = "training_builder_draft:", scopedPrefix = "training_builder_draft_v2:";
export const isLegacyBuilderDraftKey = (key: unknown): key is string => typeof key === "string" && (key.startsWith(prefix) || key.startsWith(scopedPrefix));
function scope(key: string) {
  if (key.startsWith(prefix)) return { client: id(key.slice(prefix.length)), tuple: null };
  const rest = key.slice(scopedPrefix.length), colon = rest.indexOf(":");
  if (colon < 0) return fail("KEY_INVALID");
  const encoded = rest.slice(0, colon), client = decodeURIComponent(encoded), raw = rest.slice(colon + 1);
  if (encodeURIComponent(client) !== encoded) return fail("KEY_INVALID");
  const tuple = parseRoundTripSourceJson(raw);
  if (!Array.isArray(tuple) || tuple.length !== 3 || !["simple", "periodized"].includes(tuple[0] as string)
    || tuple.slice(1).some((v: unknown) => v !== null && (typeof v !== "string" || !v.trim())) || JSON.stringify(tuple) !== raw) return fail("KEY_INVALID");
  return { client: id(client), tuple: tuple as ["simple" | "periodized", string | null, string | null] };
}

/** Validate first, then resolve real IDs outside recoverable JSON handling. No
 * draft becomes a published plan or a performed fact. Scoped storage wins over
 * the old single slot by its explicit lookup rule, never by names or timestamps.
 */
export function composeLegacyBuilderDrafts(context: CandidateIdentityContext, importedAt: string, settings: LegacySettingsSource,
  source: LegacyPlansSource, facts: LegacyBuilderDraftInput["facts"], clients: ReadonlyMap<string, string>,
  catalog: ReadonlyMap<string, string>, tables: Readonly<Record<string, readonly PlanRow[]>>, aliases: readonly PlanRow[],
  identity: (kind: PlanIdentityKind, key: string) => string) {
  if (settings.accountScope !== context.accountScope || facts.accountScope !== context.accountScope) return fail("SCOPE_MISMATCH");
  const target: PlanRow[] = [], reviews: { sourceKey: string; raw: Raw; disposition: string; reason: string | null; targetKey: string | null }[] = [];
  const prepared: Prepared[] = [], reservedScopes = new Set<string>(), keys = new Set<string>();
  const alias = new Map(aliases.map((r) => [JSON.stringify([r.source_table, r.source_row_id]), r]));
  const rows = (name: keyof LegacyPlansSource["tables"]) => source.tables[name] ?? [];
  const sourceKey = (key: string) => JSON.stringify([context.accountScope, "app_settings", key]);
  const scopeKey = (client: string, kind: string, program: string | null, book: string | null) => JSON.stringify([client, kind, program, book]);
  const sourceRows = (settings.rows ?? []).filter((r) => isLegacyBuilderDraftKey(r.key)).sort((a, b) => compare(String(a.key), String(b.key)));
  for (const raw of sourceRows) {
    const key = id(raw.key); if (keys.has(key)) return fail("IDENTITY_INVALID"); keys.add(key);
    try { const s = scope(key); if (s.tuple) reservedScopes.add(scopeKey(s.client, ...s.tuple)); } catch { /* Invalid slots remain raw review below. */ }
  }
  for (const raw of sourceRows) {
    const key = id(raw.key), rowKey = sourceKey(key);
    try {
      const keyScope = scope(key), client = clients.get(keyScope.client); if (!client) return fail("OWNER_MISSING");
      const envelope = object(parseRoundTripSourceJson(text(raw.value)));
      fields(envelope, ["kind", "programId", "bookId", "baseRevision", "draft", "updatedAt"]);
      if (envelope.kind !== "simple" && envelope.kind !== "periodized") return fail("KIND_INVALID");
      const kind = envelope.kind, programId = envelope.programId == null ? null : id(envelope.programId), bookId = envelope.bookId == null ? null : id(envelope.bookId);
      if (kind === "simple" && bookId !== null) return fail("SCOPE_INVALID");
      if (keyScope.tuple && JSON.stringify(keyScope.tuple) !== JSON.stringify([kind, programId, bookId])) return fail("SCOPE_INVALID");
      const currentScope = scopeKey(keyScope.client, kind, programId, bookId);
      if (!keyScope.tuple && reservedScopes.has(currentScope)) {
        reviews.push({ sourceKey: rowKey, raw, disposition: "SHADOWED", reason: "SCOPED_STORAGE_PRECEDENCE", targetKey: null }); continue;
      }
      const page = programId === null ? null : rows("training_programs").find((r) => r.id === programId && r.client_id === keyScope.client);
      if (programId !== null && (!page || page.deleted_at !== null || page.is_template !== 0 || page.mode !== (kind === "simple" ? "free" : "periodized"))) return fail("PROGRAM_UNAVAILABLE");
      const pages = page ? [page] : bookId === null ? [] : rows("training_programs").filter((r) => r.client_id === keyScope.client && r.book_id === bookId && r.is_template === 0 && r.deleted_at === null);
      const link = pages[0] && alias.get(JSON.stringify(["training_programs", pages[0].id]));
      const program = link ? tables.training_programs!.find((r) => r.id === link.target_program_id) ?? null : null;
      if ((programId !== null || bookId !== null) && (!program || link!.target_client_id !== client)) return fail("PROGRAM_UNAVAILABLE");
      if (program && (program.kind !== (kind === "simple" ? "SIMPLE" : "PERIODIZED")
        || !tables.training_program_members!.some((m) => m.program_id === program.id && m.client_id === client && m.archived_at === null))) return fail("PROGRAM_UNAVAILABLE");
      if (page && bookId !== null && (page.book_id || page.id) !== bookId) return fail("SCOPE_INVALID");
      const cycle = page && kind === "periodized" ? tables.training_mesocycles!.find((r) => r.id === link!.target_id && r.client_id === client) ?? null : null;
      if (page && kind === "periodized" && !cycle) return fail("PROGRAM_UNAVAILABLE");
      if (page) {
        const library = rows("training_library_programs").find((r) => r.client_id === keyScope.client && r.id === (page.book_id || page.id));
        if (!library || !Number.isSafeInteger(library.revision) || library.revision !== envelope.baseRevision) return fail("BASE_REVISION_UNVERIFIED");
      }
      const draft = object(envelope.draft), seen = new Set<string>();
      fields(draft, kind === "simple" ? ["name", "weekCount", "workouts"] : ["name", "cycleType", "repRange", "weekCount", "editingWeekIndex", "weeks", "participantIds", "sharedGroupId"]);
      text(draft.name); integer(draft.weekCount, 1, 52);
      const unique = (name: string, value: unknown) => { const k = id(value), token = `${name}:${k}`; if (seen.has(token)) return fail("DUPLICATE_ENTITY"); seen.add(token); return k; };
      const ref = (entity: PlanIdentityKind, table: string, key: string): Ref => {
        const mapped = page ? alias.get(JSON.stringify([table, key])) : undefined;
        if (mapped && (mapped.target_client_id !== client || mapped.target_program_id !== program?.id || mapped.target_id === null)) return fail("ENTITY_SCOPE_INVALID");
        if (mapped) {
          const nativeTable = table === "training_exercises" ? "training_planned_exercises" : table === "training_set_logs" ? "training_planned_sets" : table;
          if (!tables[nativeTable]?.some((r) => r.id === mapped.target_id) || seen.has(`target:${mapped.target_id}`)) return fail("ENTITY_SCOPE_INVALID");
          seen.add(`target:${mapped.target_id}`);
        }
        return { kind: entity, key: JSON.stringify([context.accountScope, "builder-draft", currentScope, table, key]), existing: mapped?.target_id as string | null ?? null };
      };
      const workouts = (value: unknown): Workout[] => array(value).map((v) => {
        const w = object(v), wk = unique("workout", w.key); fields(w, ["key", "name", "exercises", "applyToAllWeeks"]);
        if (w.applyToAllWeeks !== undefined && typeof w.applyToAllWeeks !== "boolean" || w.applyToAllWeeks === true) return fail("PENDING_COPY_ACTION");
        const wr = ref("WORKOUT", "training_workouts", wk), supersets = new Map<string, Ref>();
        return { ref: wr, title: text(w.name), lineage: tables.training_workouts!.find((r) => r.id === wr.existing)?.lineage_id as string | null ?? null,
          exercises: array(w.exercises).map((ev): Exercise => {
            const e = object(ev), ek = unique("exercise", e.key); fields(e, ["key", "catalogId", "name", "category", "equipment", "setCount", "repRange", "rir", "plannedWeight", "importedSets", "factIdentity", "applyToAllWeeks", "supersetGroupId"]);
            if (e.applyToAllWeeks !== undefined && typeof e.applyToAllWeeks !== "boolean" || e.applyToAllWeeks === true) return fail("PENDING_COPY_ACTION");
            text(e.name); text(e.repRange); for (const f of ["category", "equipment", "factIdentity", "plannedWeight"]) if (e[f] !== undefined && typeof e[f] !== "string") return fail("TEXT_INVALID");
            const exercise = catalog.get(id(e.catalogId)); if (!exercise) return fail("CATALOG_UNRESOLVED");
            if (e.setCount === null) return fail("SET_COUNT_UNSPECIFIED");
            const er = ref("EXERCISE", "training_exercises", ek), count = integer(e.setCount, 0, 999);
            const imports = e.importedSets === undefined ? [] : array(e.importedSets).map(object);
            for (const set of imports) {
              fields(set, ["historyOriginId", "plannedReps", "plannedWeight", "reps", "weight", "rpe", "completedAt", "historyDateStatus", "historyImportedAt", "setKind", "effortOutcome", "segments"]);
              if (set.setKind !== undefined && set.setKind !== "working" && set.setKind !== "drop") return fail("SET_KIND_REQUIRES_REVIEW");
              if (["historyOriginId", "plannedReps", "plannedWeight", "reps", "weight", "rpe", "historyImportedAt"].some((f) => set[f] !== undefined && typeof set[f] !== "string")
                || set.completedAt != null && typeof set.completedAt !== "string" || set.effortOutcome !== undefined && !["normal", "failure"].includes(set.effortOutcome as string)
                || set.historyDateStatus !== undefined && !["exact", "imported-unknown"].includes(set.historyDateStatus as string)) return fail("FACT_METADATA_INVALID");
              if (set.segments !== undefined) for (const s of array(set.segments)) { const segment = object(s); fields(segment, ["reps", "weight"]); text(segment.reps); text(segment.weight); }
            }
            const working = imports.filter((set) => set.setKind !== "warmup");
            if (working.length && count !== working.length) return fail("SET_COUNT_CONFLICT");
            if (!count && (text(e.repRange).trim() || typeof e.plannedWeight === "string" && e.plannedWeight.trim())) return fail("NO_PLAN_SLOTS");
            const sets = (working.length ? working : Array.from({ length: count }, () => ({} as Raw))).map((set, si) => {
              const actual = [set.reps, set.weight, set.rpe, set.completedAt].some((x) => x !== undefined && x !== null && x !== "")
                || set.setKind === "drop" || set.effortOutcome === "failure"
                || set.segments !== undefined && array(set.segments).some((s) => { const item = object(s); return item.reps !== "" || item.weight !== ""; });
              const origin = typeof set.historyOriginId === "string" && set.historyOriginId.trim() ? set.historyOriginId : null;
              const physical = page && origin ? rows("training_set_logs").filter((s) => s.exercise_id === ek && (s.id === origin || object(parseRoundTripSourceJson(text(s.data_json))).historyOriginId === origin)) : [];
              if (physical.length > 1) return fail("FACT_IDENTITY_AMBIGUOUS");
              const saved = physical[0];
              if (actual) {
                if (!saved || ["reps", "weight", "rpe"].some((f) => String(saved[f] ?? "") !== String(set[f] ?? "")) || (set.completedAt ?? null) !== saved.completed_at) return fail("PENDING_FACTS_RETAINED");
                const data = object(parseRoundTripSourceJson(text(saved.data_json)));
                if ((set.setKind ?? "working") !== (saved.set_kind ?? "working") || (set.effortOutcome ?? "normal") !== (saved.effort_outcome ?? "normal")
                  || ["historyDateStatus", "historyImportedAt"].some((f) => set[f] !== undefined && set[f] !== data[f])) return fail("PENDING_FACTS_RETAINED");
                if (set.segments !== undefined) {
                  const segments = (facts.segments ?? []).filter((s) => s.set_log_id === saved.id && s.deleted_at === null).sort((a, b) => Number(a.segment_index) - Number(b.segment_index));
                  const expected = segments.length ? segments.map((s) => ({ reps: s.reps, weight: s.weight })) : [{ reps: String(saved.reps ?? ""), weight: String(saved.weight ?? "") }];
                  if (JSON.stringify(set.segments) !== JSON.stringify(expected)) return fail("PENDING_FACTS_RETAINED");
                }
              }
              const declared = page && er.existing && !rows("training_set_logs").some((s) => s.exercise_id === ek && s.deleted_at === null)
                ? object(parseRoundTripSourceJson(text(rows("training_exercises").find((r) => r.id === ek)!.data_json))).setCount : null;
              const sr = saved ? ref("SET", "training_set_logs", id(saved.id)) : { kind: "SET" as const,
                key: typeof declared === "number" && si < declared ? JSON.stringify([context.accountScope, "DECLARED_PLAN_SLOT", ek, si])
                  : JSON.stringify([context.accountScope, "builder-draft", currentScope, ek, "set", si]), existing: null };
              // The builder's save path overrides every non-warmup set's reps
              // with the exercise range; a saved set's kg still takes precedence.
              const prescription = projectLegacyPlanPrescription({ ...set, plannedReps: text(e.repRange) }, e);
              const values = { reps: prescription.reps, repsMax: prescription.repsMax, loadGrams: prescription.loadGrams,
                durationSec: prescription.durationSec, distanceM: prescription.distanceM };
              return { ref: sr, values };
            });
            let superset: Ref | null = null;
            if (e.supersetGroupId != null && e.supersetGroupId !== "") { const group = id(e.supersetGroupId); superset = supersets.get(group) ?? { kind: "SUPERSET",
              key: JSON.stringify(wr.existing ? [context.accountScope, wk, group] : [context.accountScope, "builder-draft", currentScope, wk, group]), existing: null }; supersets.set(group, superset); }
            const base = tables.training_planned_exercises!.find((r) => r.id === er.existing);
            return { ref: er, catalog: exercise, sets, superset, rir: sourcePlanRange(e.rir, 0, 10),
              restSec: base ? base.rest_sec as number | null : 90, instruction: base ? base.instruction as string | null : null,
              lineage: base?.lineage_id as string | null ?? null };
          }) };
      });
      const members = [client];
      if (kind === "periodized") for (const member of array(draft.participantIds)) { const mapped = clients.get(id(member)); if (!mapped) return fail("PARTICIPANT_UNRESOLVED"); if (!members.includes(mapped)) members.push(mapped); }
      let simple: readonly Workout[] = [], weeks: { type: WeekType; workouts: readonly Workout[] }[] = [];
      if (kind === "simple") simple = workouts(draft.workouts);
      else {
        if (draft.sharedGroupId !== null) id(draft.sharedGroupId);
        if (!["hypertrophy", "strength", "power", "endurance", "recomp", "custom"].includes(text(draft.cycleType))) return fail("CYCLE_TYPE_INVALID");
        text(draft.repRange); integer(draft.editingWeekIndex, 0, Number(draft.weekCount) - 1);
        weeks = array(draft.weeks).map((v) => { const week = object(v); fields(week, ["key", "type", "workouts"]); unique("week", week.key);
          if (!["base", "light", "medium", "heavy", "deload"].includes(text(week.type))) return fail("WEEK_TYPE_INVALID");
          return { type: week.type as WeekType, workouts: workouts(week.workouts) }; });
        if (weeks.length !== draft.weekCount) return fail("WEEK_COUNT_CONFLICT");
      }
      prepared.push({ raw, sourceKey: rowKey, client, sourceClient: keyScope.client, kind, nativeKey: kind === "simple" ? String(program?.id ?? "new:SIMPLE")
        : program === null ? "new:PERIODIZED" : `builder:${program.id}:${cycle?.id ?? "add"}`, scopeKey: currentScope, scoped: keyScope.tuple !== null, program, cycle, draft, workouts: simple, weeks, members });
    } catch (error) {
      const reason = error instanceof Error && /^R04_ID_LEDGER_(?:BUILDER|PLANS)_[A-Z_]+$/u.test(error.message) ? error.message : "R04_ID_LEDGER_BUILDER_SOURCE_INVALID";
      reviews.push({ sourceKey: rowKey, raw, disposition: "REVIEW_REQUIRED", reason, targetKey: null });
    }
  }
  const destinations = new Map<string, Prepared[]>();
  for (const p of prepared) { const key = JSON.stringify([p.client, p.nativeKey]), group = destinations.get(key) ?? []; group.push(p); destinations.set(key, group); }
  const resolve = (ref: Ref) => ref.existing ?? identity(ref.kind, ref.key);
  function materialize(w: Workout): PlannedWorkout {
    return { id: resolve(w.ref), title: w.title, ...(w.lineage ? { lineageId: w.lineage } : {}), exercises: w.exercises.map((e) => ({
      id: resolve(e.ref), exerciseId: e.catalog, restSec: e.restSec, instruction: e.instruction, rir: e.rir, ...(e.lineage ? { lineageId: e.lineage } : {}),
      ...(e.superset ? { supersetId: resolve(e.superset) } : {}), sets: e.sets.map((s) => ({ id: resolve(s.ref), ...s.values })),
    })) };
  }
  function baseWorkouts(programId: string, weekId: string | null): PlannedWorkout[] {
    return tables.training_workouts!.filter((w) => w.program_id === programId && w.week_id === weekId).sort((a, b) => Number(a.position) - Number(b.position)).map((w) => ({
      id: String(w.id), title: String(w.title), ...(w.lineage_id ? { lineageId: String(w.lineage_id) } : {}),
      exercises: tables.training_planned_exercises!.filter((e) => e.workout_id === w.id).sort((a, b) => Number(a.position) - Number(b.position)).map((e) => ({
        id: String(e.id), exerciseId: String(e.exercise_id), restSec: e.rest_sec as number | null, instruction: e.instruction as string | null,
        rir: e.rir_min === null ? null : { min: Number(e.rir_min), max: e.rir_max as number | null },
        ...(e.lineage_id ? { lineageId: String(e.lineage_id) } : {}), ...(e.superset_id ? { supersetId: String(e.superset_id) } : {}),
        sets: tables.training_planned_sets!.filter((s) => s.planned_exercise_id === e.id).sort((a, b) => Number(a.position) - Number(b.position)).map((s) => ({
          id: String(s.id), reps: s.reps as number | null, repsMax: s.reps_max as number | null, loadGrams: s.load_grams as number | null,
          durationSec: s.duration_sec as number | null, distanceM: s.distance_m as number | null,
        })),
      })),
    }));
  }
  for (const group of destinations.values()) {
    if (group.length !== 1) { for (const p of group) reviews.push({ sourceKey: p.sourceKey, raw: p.raw, disposition: "REVIEW_REQUIRED", reason: "TARGET_DRAFT_COLLISION", targetKey: null }); continue; }
    const p = group[0]!; let json: string;
    if (p.kind === "simple") {
      const draft: SimpleProgramDraft = { title: text(p.draft.name), plan: { weeks: Number(p.draft.weekCount), workouts: p.workouts.map(materialize) } };
      const base: SimpleProgramDraft | null = p.program === null ? null : { title: String(p.program.title), plan: { weeks: Number(p.program.weeks), workouts: baseWorkouts(String(p.program.id), null) } };
      const envelope = { envelope: 2, draft, base };
      if (!storedBuilderDraft(envelope)) return fail("TARGET_SHAPE_INVALID"); json = JSON.stringify(envelope);
    } else {
      const draft = { baseRevision: p.program ? Number(p.program.revision) : null, programTitle: String(p.program?.title ?? ""), title: text(p.draft.name),
        cycleType: p.draft.cycleType as CycleType, repsText: text(p.draft.repRange), startDate: String(p.cycle?.start_date ?? ""), editing: Number(p.draft.editingWeekIndex), members: p.members,
        weeks: p.weeks.map((w): BuilderWeek => ({ type: w.type, workouts: w.workouts.map(materialize) })),
        baseWeeks: p.cycle === null ? null : tables.training_weeks!.filter((w) => w.mesocycle_id === p.cycle!.id).sort((a, b) => Number(a.position) - Number(b.position))
          .map((w): BuilderWeek => ({ type: w.week_type as WeekType, workouts: baseWorkouts(String(p.program!.id), String(w.id)) })) };
      if (!storedMesocycleBuilder(draft)) return fail("TARGET_SHAPE_INVALID"); json = JSON.stringify(draft);
    }
    target.push({ workspace_id: context.targetWorkspaceId, client_id: p.client, draft_key: p.nativeKey, base_revision: p.program?.revision ?? null, draft_json: json, updated_at: importedAt });
    reviews.push({ sourceKey: p.sourceKey, raw: p.raw, disposition: "EDITABLE_DRAFT", reason: null, targetKey: p.nativeKey });
  }
  return { rows: target, representations: reviews.sort((a, b) => compare(a.sourceKey, b.sourceKey)), editableDraftRows: target.length,
    reviewRows: reviews.filter((r) => r.disposition === "REVIEW_REQUIRED").length, factsCreated: 0 as const };
}
