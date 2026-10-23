import type { CandidateIdentityContext } from "./CandidateIdentityLedger.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource, type PlanSourceTable } from "./LegacyPlansSourceReader.ts";
import { projectLegacyPlanPrescription, sourceObject, sourcePlanRange } from "./LegacyPlanPrescription.ts";
import { isExplicitTimestamp } from "./ExactScaledHundredth.ts";
import type { PlannedExercise, PlannedSet, PlannedWorkout } from "../../apps/mobile/src/features/training/plans/domain/SimplePlanModel.ts";
import { storedTemplate, storedWorkout } from "../../apps/mobile/src/features/training/plans/domain/StoredPlanShape.ts";
import type { TemplatePayload } from "../../apps/mobile/src/features/training/plans/domain/TemplateModel.ts";
import type { WeekType } from "../../apps/mobile/src/features/training/plans/domain/PeriodizedModel.ts";

type Raw = Readonly<Record<string, unknown>>;
export type PlanRow = Readonly<Record<string, string | number | null>>;
export type PlanIdentityKind = "PROGRAM" | "MESOCYCLE" | "LINEAGE" | "WEEK" | "WORKOUT" | "EXERCISE" | "SET" | "SUPERSET" | "TEMPLATE";
export const PLAN_TARGET_TABLES = ["training_programs", "training_program_members", "training_mesocycles", "training_weeks", "training_workouts",
  "training_planned_exercises", "training_planned_sets", "training_simple_overrides", "training_client_selection", "training_mesocycle_selection"] as const;
export const TEMPLATE_TARGET_TABLES = [...PLAN_TARGET_TABLES, "training_templates"] as const;
export interface ExercisePlanLink { readonly sourceKey: string; readonly clientId: string; readonly exerciseId: string; readonly raw: Raw }
function fail(code: string): never { throw new Error(`R04_ID_LEDGER_PLANS_${code}`); }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) return fail("VALUE_INVALID"); return value; }
function title(value: unknown): string { const result = text(value); if (result.trim().length > 80) return fail("TITLE_UNREPRESENTABLE"); return result; }
function pos(value: unknown): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail("POSITION_INVALID"); return value; }
function time(value: unknown): string { if (!isExplicitTimestamp(value)) return fail("TIME_INVALID"); return value; }
function deleted(row: Raw): boolean { if (row.deleted_at === null) return false; time(row.deleted_at); return true; }
function key(scope: string, table: string, id: string): string { return JSON.stringify([scope, table, id]); }
function same(a: unknown, b: unknown): boolean { return JSON.stringify(a) === JSON.stringify(b); }

/** Source rows are reparsed, not inherited from preflight flags: a deleted duplicate
 * position is historical evidence, not a second active slot or an invented fact. */
export function composeLegacyPlans(context: CandidateIdentityContext, importedAt: string, source: LegacyPlansSource,
  clientIds: ReadonlyMap<string, string>, exerciseLinks: ReadonlyMap<string, ExercisePlanLink>,
  identity: (kind: PlanIdentityKind, sourceKey: string) => string, templatesEnabled = false) {
  if (source.accountScope !== context.accountScope) return fail("SCOPE_MISMATCH"); time(importedAt);
  if (Object.keys(source.tables).length !== PLAN_SOURCE_TABLES.length || PLAN_SOURCE_TABLES.some((t) => source.tables[t] !== null && !Array.isArray(source.tables[t]))) return fail("SOURCE_TABLE_MISSING");
  const scope = context.accountScope, workspace = context.targetWorkspaceId;
  const tables = Object.fromEntries(TEMPLATE_TARGET_TABLES.map((name) => [name, [] as PlanRow[]])) as Record<typeof TEMPLATE_TARGET_TABLES[number], PlanRow[]>;
  const maps = new Map<PlanSourceTable, Map<string, Raw>>(); const json = new Map<Raw, Raw>();
  const dispositions: Record<string, { clientId: string | null; targetId: string | null; targetProgramId: string | null; weekIndex: number | null; disposition: string }> = {};
  const metadata: unknown[] = [];
  const rows = (table: PlanSourceTable) => source.tables[table] ?? [];
  const sourceKey = (table: PlanSourceTable, row: Raw) => key(scope, table, text(row.id));
  for (const table of ["training_programs", "training_weeks", "training_workouts", "training_exercises", "training_set_logs"] as const) {
    if (source.tables[table] === null) return fail("SOURCE_TABLE_MISSING");
    const index = new Map<string, Raw>(); maps.set(table, index);
    for (const row of rows(table)) {
      const id = text(row.id); if (index.has(id)) return fail("IDENTITY_DUPLICATE"); index.set(id, row);
      deleted(row); json.set(row, sourceObject(table === "training_programs" ? row.settings_json : row.data_json));
    }
  }
  const owner = new Map<Raw, string>();
  const parent = new Map<Raw, Raw>();
  const programOf = new Map<Raw, Raw>();
  for (const p of rows("training_programs")) {
    const client = text(p.client_id); if (!clientIds.has(client)) return fail("OWNER_MISSING");
    if (p.mode !== "free" && p.mode !== "periodized" || p.is_template !== 0 && p.is_template !== 1) return fail("MODE_INVALID");
    owner.set(p, client); programOf.set(p, p); time(p.created_at); time(p.updated_at);
  }
  for (const table of ["training_weeks", "training_workouts", "training_exercises", "training_set_logs"] as const) for (const row of rows(table)) {
    const parentTable = table === "training_weeks" ? "training_programs" : table === "training_workouts" ? "training_weeks" : table === "training_exercises" ? "training_workouts" : "training_exercises";
    const parentId = table === "training_weeks" ? row.program_id : table === "training_workouts" ? row.week_id : table === "training_exercises" ? row.workout_id : row.exercise_id;
    if (table === "training_workouts" && row.program_id === null && row.week_id === null) {
      const client = text(row.client_id); if (!clientIds.has(client)) return fail("OWNER_MISSING"); owner.set(row, client); continue;
    }
    const p = maps.get(parentTable)!.get(text(parentId)); if (!p) return fail("PARENT_MISSING");
    parent.set(row, p); owner.set(row, owner.get(p)!);
    if (programOf.has(p)) programOf.set(row, programOf.get(p)!);
    if (table === "training_workouts" && (row.client_id !== owner.get(p) || row.program_id !== programOf.get(p)?.id)) return fail("OWNER_MISMATCH");
    pos(table === "training_weeks" ? row.week_index : table === "training_set_logs" ? row.set_index : row.sort_index);
  }
  const activeRows = new Map<Raw, boolean>();
  function active(row: Raw): boolean {
    const cached = activeRows.get(row); if (cached !== undefined) return cached;
    // Lifecycle timestamps were validated once above. Avoid reparsing ancestors
    // for every descendant of a large legacy program.
    const result = row.deleted_at === null && (parent.has(row) ? active(parent.get(row)!) : true);
    activeRows.set(row, result); return result;
  }
  function eligible(row: Raw): boolean { const p = programOf.get(row); return p !== undefined && p.is_template === 0 && active(row); }
  for (const table of ["training_programs", "training_weeks", "training_workouts", "training_exercises", "training_set_logs"] as const) for (const row of rows(table)) {
    const p = programOf.get(row), id = sourceKey(table, row);
    dispositions[id] = { clientId: owner.get(row) ?? null, targetId: null, targetProgramId: null, weekIndex: null,
      disposition: p?.is_template === 1 ? "RETAINED_TEMPLATE_SOURCE" : p === undefined ? "RETAINED_FREE_WORKOUT_SOURCE" : !active(row) ? "RETAINED_DELETED_SOURCE" : "PENDING_PLAN" };
  }
  const byParent = new Map<PlanSourceTable, Map<Raw, Raw[]>>();
  for (const table of ["training_weeks", "training_workouts", "training_exercises", "training_set_logs"] as const) {
    const index = new Map<Raw, Raw[]>(); byParent.set(table, index);
    for (const row of rows(table)) if (eligible(row) || templatesEnabled && active(row) && programOf.get(row)?.is_template === 1) {
      const p = parent.get(row)!; const siblings = index.get(p) ?? []; siblings.push(row); index.set(p, siblings);
    }
    const column = table === "training_weeks" ? "week_index" : table === "training_set_logs" ? "set_index" : "sort_index";
    for (const siblings of index.values()) {
      siblings.sort((a, b) => pos(a[column]) - pos(b[column]));
      if (new Set(siblings.map((r) => r[column])).size !== siblings.length) return fail("POSITION_AMBIGUOUS");
    }
  }
  const children = (table: PlanSourceTable, p: Raw): readonly Raw[] => byParent.get(table)?.get(p) ?? [];
  const library = new Map<string, Raw>();
  for (const row of rows("training_library_programs")) {
    const client = text(row.client_id), id = text(row.id); if (!clientIds.has(client)) return fail("OWNER_MISSING");
    const k = JSON.stringify([client, id]); if (library.has(k)) return fail("LIBRARY_IDENTITY_DUPLICATE"); library.set(k, row);
    time(row.created_at); if (row.archived_at !== null) time(row.archived_at);
  }
  const groups = new Map<string, Raw[]>();
  for (const p of rows("training_programs").filter(eligible)) {
    if (p.book_id !== null && typeof p.book_id !== "string") return fail("VALUE_INVALID");
    if (typeof p.book_id === "string" && p.book_id !== "" && !p.book_id.trim()) return fail("BOOK_ID_INVALID");
    const root = typeof p.book_id === "string" && p.book_id.trim() ? p.book_id : text(p.id);
    const k = JSON.stringify([owner.get(p), root]); const group = groups.get(k) ?? []; group.push(p); groups.set(k, group);
  }
  const programTargets = new Map<Raw, string>(), cycleTargets = new Map<Raw, string>(), rootTargets = new Map<string, string>();
  const sharedOwners = new Set<string>(); const planBases: unknown[] = [];
  const sharedMembership = new Map<string, string>();
  const rowId = (kind: PlanIdentityKind, table: PlanSourceTable, row: Raw) => identity(kind, sourceKey(table, row));
  function mark(table: PlanSourceTable, row: Raw, id: string | null, programId: string, weekIndex: number | null) {
    const template = programOf.get(row)?.is_template === 1;
    Object.assign(dispositions[sourceKey(table, row)]!, { targetId: id, targetProgramId: template ? null : programId, weekIndex,
      disposition: template ? "TEMPLATE_PLAN" : "PLAN" });
  }
  function workout(p: Raw, w: Raw, programId: string, weekIndex: number, targetWorkoutId?: string, templateSlot?: string): PlannedWorkout {
    const id = targetWorkoutId ?? rowId("WORKOUT", "training_workouts", w); mark("training_workouts", w, id, programId, weekIndex);
    const supersets = new Map<string, string>();
    const exercises: PlannedExercise[] = children("training_exercises", w).map((e, ei) => {
      const eId = templateSlot === undefined ? rowId("EXERCISE", "training_exercises", e)
        : identity("EXERCISE", JSON.stringify([scope, "template-exercise-slot", templateSlot, ei])), data = json.get(e)!;
      const link = exerciseLinks.get(sourceKey("training_exercises", e));
      if (!link || link.clientId !== owner.get(e) || Object.keys(e).some((k) => !same(e[k], link.raw[k]))) return fail("EXERCISE_LINK_MISMATCH");
      mark("training_exercises", e, eId, programId, weekIndex);
      if (typeof e.note !== "string" || e.note.trim().length > 500) return fail("INSTRUCTION_UNREPRESENTABLE");
      let rest: number | null = null;
      if (data.restSec !== undefined && data.restSec !== null) { rest = pos(data.restSec); if (rest < 1 || rest > 3600) return fail("PRESCRIPTION_INVALID"); }
      const logs = children("training_set_logs", e);
      const exerciseRir = data.rir !== undefined && data.rir !== null && data.rir !== "";
      const rir = sourcePlanRange(exerciseRir ? data.rir : logs[0] === undefined ? undefined : json.get(logs[0])!.rir, 0, 10);
      planBases.push({ sourceKey: sourceKey("training_exercises", e), rir: exerciseRir ? "exercise.rir" : logs[0] === undefined ? "ABSENT" : `${sourceKey("training_set_logs", logs[0])}.rir` });
      const sets: PlannedSet[] = [];
      for (const set of logs) {
        const setData = json.get(set)!; const kind = set.set_kind ?? "working";
        if (!["working", "warmup", "drop"].includes(String(kind))) return fail("SET_KIND_INVALID");
        if (kind === "warmup") { dispositions[sourceKey("training_set_logs", set)]!.disposition = p.is_template === 1 ? "RETAINED_TEMPLATE_WARMUP_SOURCE" : "RETAINED_WARMUP_FACT_SOURCE"; continue; }
        const id = templateSlot === undefined ? rowId("SET", "training_set_logs", set)
          : identity("SET", JSON.stringify([scope, "template-set-slot", eId, sets.length])), prescription = projectLegacyPlanPrescription(setData, data);
        const { basis, ...values } = prescription; sets.push({ id, ...values }); mark("training_set_logs", set, id, programId, weekIndex);
        planBases.push({ sourceKey: sourceKey("training_set_logs", set), basis });
      }
      if (sets.length === 0 && data.setCount !== undefined && data.setCount !== null) {
        const count = pos(data.setCount); if (count > 999) return fail("PRESCRIPTION_INVALID");
        const { basis, ...values } = projectLegacyPlanPrescription({}, data);
        for (let i = 0; i < count; i++) sets.push({ id: identity("SET", templateSlot === undefined
          ? JSON.stringify([scope, "DECLARED_PLAN_SLOT", e.id, i]) : JSON.stringify([scope, "template-set-slot", eId, i])), ...values });
        planBases.push({ sourceKey: sourceKey("training_exercises", e), declaredSetCount: count, basis });
      }
      let supersetId: string | undefined;
      if (data.supersetGroupId !== undefined && data.supersetGroupId !== null && data.supersetGroupId !== "") {
        const group = text(data.supersetGroupId);
        supersetId = supersets.get(group) ?? identity("SUPERSET", templateSlot === undefined
          ? JSON.stringify([scope, w.id, group]) : JSON.stringify([scope, "template-superset-slot", templateSlot, ei]));
        supersets.set(group, supersetId);
      }
      return { id: eId, exerciseId: link.exerciseId, restSec: rest, instruction: e.note.trim() ? e.note : null, rir, sets,
        ...(p.mode === "periodized" && p.is_template !== 1 ? { lineageId: identity("LINEAGE", JSON.stringify([scope, "exercise-lineage", e.id])) } : {}), ...(supersetId ? { supersetId } : {}) };
    });
    const result: PlannedWorkout = { id, title: title(w.name), exercises,
      ...(p.mode === "periodized" && p.is_template !== 1 ? { lineageId: identity("LINEAGE", JSON.stringify([scope, "workout-lineage", w.id])) } : {}) };
    if (!storedWorkout(result)) return fail("TARGET_SHAPE_INVALID");
    return result;
  }
  function persistWorkout(value: PlannedWorkout, programId: string, weekId: string | null, position: number) {
    tables.training_workouts.push({ id: value.id, workspace_id: workspace, program_id: programId, week_id: weekId, position, title: value.title, lineage_id: value.lineageId ?? null });
    value.exercises.forEach((e, i) => {
      tables.training_planned_exercises.push({ id: e.id, workspace_id: workspace, workout_id: value.id, position: i, exercise_id: e.exerciseId,
        rest_sec: e.restSec, instruction: e.instruction, rir_min: e.rir?.min ?? null, rir_max: e.rir?.max ?? null, lineage_id: e.lineageId ?? null, superset_id: e.supersetId ?? null });
      e.sets.forEach((s, n) => tables.training_planned_sets.push({ id: s.id, workspace_id: workspace, planned_exercise_id: e.id, position: n,
        reps: s.reps, reps_max: s.repsMax, load_grams: s.loadGrams, duration_sec: s.durationSec, distance_m: s.distanceM }));
    });
  }
  for (const [groupKey, pages] of [...groups].sort(([a], [b]) => compare(a, b))) {
    const kinds = new Set(pages.map((p) => p.mode)); if (kinds.size !== 1) return fail("BOOK_MODE_CONFLICT");
    const client = owner.get(pages[0]!)!, clientId = clientIds.get(client)!, lib = library.get(groupKey), kind = pages[0]!.mode === "free" ? "SIMPLE" : "PERIODIZED";
    if (kind === "SIMPLE" && pages.length !== 1) return fail("SIMPLE_BOOK_AMBIGUOUS");
    if (lib && lib.mode !== pages[0]!.mode) return fail("BOOK_MODE_CONFLICT");
    function order(a: Raw, b: Raw): number {
      const ai = json.get(a)!.pageIndex, bi = json.get(b)!.pageIndex;
      const an = typeof ai === "number" && Number.isFinite(ai), bn = typeof bi === "number" && Number.isFinite(bi);
      return an && bn && ai !== bi ? Number(ai) - Number(bi) : an !== bn ? an ? -1 : 1 : compare(time(a.created_at), time(b.created_at));
    }
    pages.sort(order); for (let i = 1; i < pages.length; i++) if (order(pages[i - 1]!, pages[i]!) === 0) return fail("PAGE_ORDER_AMBIGUOUS");
    const programId = identity("PROGRAM", JSON.stringify([scope, "book", groupKey]));
    rootTargets.set(groupKey, programId);
    const archivedAt = lib?.archived_at === null || lib === undefined ? null : time(lib.archived_at);
    const createdAt = lib ? time(lib.created_at) : importedAt;
    tables.training_programs.push({ id: programId, workspace_id: workspace, kind, title: title(lib?.name ?? pages[0]!.name), revision: 1,
      created_at: createdAt, updated_at: importedAt, weeks: kind === "SIMPLE" ? children("training_weeks", pages[0]!).length : null });
    tables.training_program_members.push({ workspace_id: workspace, program_id: programId, client_id: clientId, joined_at: createdAt, archived_at: archivedAt, sort_position: null });
    metadata.push({ groupKey, programId, headerBasis: lib ? "SOURCE_LIBRARY_ROW" : "NEW_CONTAINER_FROM_FIRST_SOURCE_PAGE", sourceLibrary: lib ?? null });
    for (const [pageIndex, p] of pages.entries()) {
      programTargets.set(p, programId); const data = json.get(p)!, weeks = children("training_weeks", p);
      if (weeks.length < 1 || weeks.length > 52 || weeks.some((w, i) => w.week_index !== i)) return fail("WEEKS_UNREPRESENTABLE");
      if (data.totalWeeks !== undefined && data.totalWeeks !== weeks.length) return fail("WEEK_COUNT_CONFLICT");
      if (kind === "SIMPLE") {
        mark("training_programs", p, programId, programId, null);
        const base = children("training_workouts", weeks[0]!);
        for (let wi = 0; wi < weeks.length; wi++) {
          const week = weeks[wi]!, current = children("training_workouts", week);
          if (current.length !== base.length || current.some((w, i) => w.sort_index !== base[i]!.sort_index)) return fail("SIMPLE_SLOTS_UNREPRESENTABLE");
          mark("training_weeks", week, null, programId, wi + 1);
          dispositions[sourceKey("training_weeks", week)]!.disposition = "SIMPLE_WEEK_INDEX";
          current.forEach((w) => {
            const logicalId = identity("WORKOUT", JSON.stringify([scope, "simple-slot", p.id, pos(w.sort_index)]));
            const value = workout(p, w, programId, wi + 1, logicalId);
            if (wi === 0) persistWorkout(value, programId, null, pos(w.sort_index));
            else tables.training_simple_overrides.push({ workspace_id: workspace, client_id: clientId, program_id: programId,
              week_index: wi + 1, workout_id: logicalId, workout_json: JSON.stringify(value) });
          });
        }
      } else {
        const mesocycleId = rowId("MESOCYCLE", "training_programs", p); cycleTargets.set(p, mesocycleId); mark("training_programs", p, mesocycleId, programId, null);
        const shared = data.sharedGroupId === undefined || data.sharedGroupId === null || data.sharedGroupId === "" ? null : text(data.sharedGroupId).trim();
        if (shared) {
          if (data.participantIds !== undefined && data.participantIds !== null && (!Array.isArray(data.participantIds)
            || data.participantIds.some((id: unknown) => typeof id !== "string" || !id.trim()))) return fail("SHARED_MEMBERSHIP_INVALID");
          // The legacy accessor adds the owner. Equal group IDs alone do not prove
          // current reciprocal participation after somebody has left the group.
          const members = [...new Set([client, ...((data.participantIds as readonly string[] | null | undefined) ?? [])])].sort(compare);
          const signature = JSON.stringify(members), existing = sharedMembership.get(shared);
          if (existing !== undefined && existing !== signature) return fail("SHARED_MEMBERSHIP_CONFLICT"); sharedMembership.set(shared, signature);
          metadata.push({ sourceProgramId: p.id, sharedGroupId: shared, declaredParticipants: members,
            absentDeclaredClients: members.filter((id) => !clientIds.has(id)) });
        }
        const groupOwner = JSON.stringify([shared, client]);
        if (shared && sharedOwners.has(groupOwner)) return fail("SHARED_PAGE_AMBIGUOUS"); if (shared) sharedOwners.add(groupOwner);
        const lineageId = identity("LINEAGE", JSON.stringify([scope, shared ? "shared-page" : "page", shared ?? p.id]));
        const repRange = sourcePlanRange(data.repRange, 1, 100);
        const cycle = p.cycle_type === "" ? null : p.cycle_type;
        if (cycle !== null && !["hypertrophy", "strength", "power", "endurance", "recomp", "custom"].includes(String(cycle))) return fail("CYCLE_TYPE_UNREPRESENTABLE");
        let start: string | null = null;
        if (data.startDate !== undefined && data.startDate !== null && data.startDate !== "") {
          start = text(data.startDate); const date = new Date(`${start}T00:00:00Z`);
          if (!/^\d{4}-\d{2}-\d{2}$/u.test(start) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start) return fail("DATE_INVALID");
        }
        tables.training_mesocycles.push({ id: mesocycleId, workspace_id: workspace, program_id: programId, client_id: clientId,
          lineage_id: lineageId, position: pageIndex, title: title(p.name), created_at: time(p.created_at), cycle_type: cycle as string | null,
          rep_min: repRange?.min ?? null, rep_max: repRange?.max ?? null, start_date: start, group_left_at: null });
        for (const week of weeks) {
          const weekId = rowId("WEEK", "training_weeks", week), position = pos(week.week_index);
          const type = week.week_type === "" ? "base" : week.week_type;
          if (!["base", "light", "medium", "heavy", "deload"].includes(String(type))) return fail("WEEK_TYPE_UNREPRESENTABLE");
          tables.training_weeks.push({ id: weekId, workspace_id: workspace, mesocycle_id: mesocycleId, position, week_type: type as string });
          mark("training_weeks", week, weekId, programId, position + 1);
          for (const w of children("training_workouts", week)) persistWorkout(workout(p, w, programId, position + 1), programId, weekId, pos(w.sort_index));
        }
      }
    }
  }
  if (templatesEnabled) for (const p of rows("training_programs").filter((r) => r.is_template === 1 && active(r)).sort((a, b) => compare(text(a.id), text(b.id)))) {
    // Migration 027 binds templates to an account, independently of the client
    // used to author the plan. Never infer or silently repair a missing binding.
    if (p.template_workspace_id !== context.sourceWorkspaceId) return fail("TEMPLATE_OWNER_MISMATCH");
    if (p.book_id !== null) return fail("TEMPLATE_BOOK_UNREPRESENTABLE");
    const id = rowId("TEMPLATE", "training_programs", p), weeks = children("training_weeks", p), data = json.get(p)!;
    if (weeks.length < 1 || weeks.length > 52 || weeks.some((w, i) => w.week_index !== i)) return fail("WEEKS_UNREPRESENTABLE");
    if (data.totalWeeks !== undefined && data.totalWeeks !== weeks.length) return fail("WEEK_COUNT_CONFLICT");
    const templateWeeks = weeks.map((week, wi) => {
      const type = week.week_type === "" ? "base" : week.week_type;
      if (!["base", "light", "medium", "heavy", "deload"].includes(String(type))) return fail("WEEK_TYPE_UNREPRESENTABLE");
      mark("training_weeks", week, null, id, wi + 1);
      return { type: type as WeekType, workouts: children("training_workouts", week).map((w, i) => {
        const slot = p.mode === "free" ? JSON.stringify([scope, "template-workout-slot", p.id, i]) : undefined;
        return workout(p, w, id, wi + 1, slot === undefined ? undefined : identity("WORKOUT", slot), slot);
      }) };
    });
    let payload: TemplatePayload;
    if (p.mode === "free") {
      if (templateWeeks.some((w) => w.type !== "base" || !same(w.workouts, templateWeeks[0]!.workouts))) return fail("SIMPLE_TEMPLATE_WEEKS_UNREPRESENTABLE");
      payload = { kind: "SIMPLE", weeks: weeks.length, workouts: templateWeeks[0]!.workouts };
    } else payload = { kind: "MESOCYCLE", mesocycle: { title: title(p.name), weeks: templateWeeks } };
    if (!storedTemplate(payload)) return fail("TARGET_SHAPE_INVALID");
    mark("training_programs", p, id, id, null);
    tables.training_templates.push({ id, workspace_id: workspace, kind: payload.kind, title: title(p.name), payload_json: JSON.stringify(payload),
      revision: 1, created_at: time(p.created_at), updated_at: time(p.updated_at) });
    metadata.push({ sourceKey: sourceKey("training_programs", p), targetTemplateId: id, sourceTemplateKind: p.mode,
      targetTemplateKind: payload.kind, sourceAuthorClientId: owner.get(p), sourceWorkspaceId: p.template_workspace_id,
      omittedFromTemplate: "EXECUTIONS_DATES_HISTORY_MEMBERS_LINEAGE", sourceSettingsRetained: true });
  }
  // A retained fact/deleted row may have a proven book/week context even when
  // it has no active planned entity. This is contextual provenance, not revival.
  for (const table of ["training_programs", "training_weeks", "training_workouts", "training_exercises", "training_set_logs"] as const) for (const row of rows(table)) {
    const p = programOf.get(row); if (!p || p.is_template === 1) continue;
    const root = p.book_id === null || p.book_id === "" ? p.id : typeof p.book_id === "string" && p.book_id.trim() ? p.book_id : null;
    const targetProgramId = root === null ? undefined : rootTargets.get(JSON.stringify([owner.get(p), root]));
    if (!targetProgramId) continue;
    const disposition = dispositions[sourceKey(table, row)]!; disposition.targetProgramId = targetProgramId;
    let ancestor: Raw | undefined = row;
    while (ancestor && maps.get("training_weeks")!.get(ancestor.id as string) !== ancestor) ancestor = parent.get(ancestor);
    const index = ancestor?.week_index;
    if (disposition.weekIndex === null && typeof index === "number" && Number.isSafeInteger(index) && index >= 0 && index < 52) disposition.weekIndex = index + 1;
  }
  const selectionOwners = new Set<string>();
  for (const row of rows("training_workspaces")) {
    const client = text(row.client_id); if (!clientIds.has(client) || selectionOwners.has(client)) return fail("SELECTION_OWNER_INVALID"); selectionOwners.add(client);
    if (row.deleted_at !== null) { time(row.deleted_at); continue; }
    sourceObject(row.week_state_json); time(row.updated_at);
    if (row.active_program_id === null || row.active_program_id === "") continue;
    const p = maps.get("training_programs")!.get(text(row.active_program_id)), programId = p && programTargets.get(p);
    const member = tables.training_program_members.find((m) => m.program_id === programId && m.client_id === clientIds.get(client));
    if (!p || owner.get(p) !== client || !programId || !member || member.archived_at !== null) {
      metadata.push({ client, sourceActiveProgramId: row.active_program_id, selectionDisposition: "UNRESOLVED_NOT_SELECTED" }); continue;
    }
    tables.training_client_selection.push({ workspace_id: workspace, client_id: clientIds.get(client)!, program_id: programId });
    if (cycleTargets.has(p)) tables.training_mesocycle_selection.push({ workspace_id: workspace, client_id: clientIds.get(client)!, program_id: programId, mesocycle_id: cycleTargets.get(p)! });
  }
  const sourceRows: PlanRow[] = [];
  for (const table of ["training_programs", "training_weeks", "training_workouts", "training_exercises", "training_set_logs"] as const) for (const row of rows(table)) {
    const k = sourceKey(table, row), d = dispositions[k]!;
    sourceRows.push({ source_key: k, source_table: table, source_row_id: text(row.id), target_client_id: d.clientId === null ? null : clientIds.get(d.clientId)!,
      target_id: d.targetId, target_program_id: d.targetProgramId, week_index: d.weekIndex, disposition: d.disposition, source_json: JSON.stringify(row) });
  }
  sourceRows.sort((a, b) => compare(String(a.source_key), String(b.source_key)));
  return { tables, sourceRows, metadata, planBases,
    deferredArchiveRows: rows("training_archive_entries").length, deferredTemplatePages: rows("training_programs").filter((p) => p.is_template === 1 && (!templatesEnabled || !active(p))).length,
    deferredLibraryRows: [...library.keys()].filter((k) => !groups.has(k)).length,
    deferredWorkspaceStateRows: rows("training_workspaces").filter((r) => Object.keys(sourceObject(r.week_state_json)).length > 0).length,
    deferredViewRows: rows("training_program_view_state").length, deferredPreferenceRows: rows("training_library_preferences").length,
    retainedSourceRows: sourceRows.filter((r) => !["PLAN", "SIMPLE_WEEK_INDEX", "TEMPLATE_PLAN"].includes(String(r.disposition))).length, finalizable: false as const };
}
