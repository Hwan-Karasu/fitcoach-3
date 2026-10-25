import type { CandidateIdentityContext } from "../../../../../shared/migration/LegacyIdentityBinding.ts";
import { isExplicitTimestamp } from "../../../../../shared/migration/LegacyValues.ts";
import { parseRoundTripSourceJson } from "../../../../../shared/migration/SourceJson.ts";
import { PLAN_SOURCE_TABLES, type LegacyPlansSource, type PlanSourceTable } from "../../../../../shared/migration/LegacyPlanSources.ts";
import { composeLegacyPlans, type ExercisePlanLink, type PlanIdentityKind, type PlanRow } from "./LegacyPlansProjection.ts";

type Raw = Readonly<Record<string, unknown>>;
function fail(code: string): never { throw new Error(`R04_ID_LEDGER_ARCHIVE_PLANS_${code}`); }
function object(value: unknown): Raw {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("OBJECT_INVALID");
  return value as Raw;
}
function array(value: unknown): readonly unknown[] { if (!Array.isArray(value)) return fail("ARRAY_UNOBSERVED"); return value; }
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) return fail("TEXT_INVALID"); return value; }
function position(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return fail("POSITION_INVALID"); return value;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  return fail("VALUE_INVALID");
}
interface Pointer {
  readonly archive: string; readonly client: string; readonly path: string; readonly raw: unknown;
  readonly virtualKey: string;
}

/** Adapt snapshot PLAN structure to the already verified Plans projector. Virtual
 * rows are local adapter values, never legacy physical rows or performed facts.
 * Every output alias points back to the exact archive JSON path and original raw. */
export function composeLegacyArchivePlans(context: CandidateIdentityContext, importedAt: string, source: LegacyPlansSource,
  clientIds: ReadonlyMap<string, string>, catalogIds: ReadonlyMap<string, string>,
  identity: (kind: PlanIdentityKind, sourceKey: string) => string) {
  if (source.accountScope !== context.accountScope || !isExplicitTimestamp(importedAt)) return fail("SCOPE_INVALID");
  const scope = context.accountScope;
  const tables: Record<PlanSourceTable, Raw[] | null> = Object.fromEntries(PLAN_SOURCE_TABLES.map((t, i) => [t, i < 6 ? [] : null])) as Record<PlanSourceTable, Raw[] | null>;
  const links = new Map<string, ExercisePlanLink>(), pointers: Pointer[] = [], entries: Raw[] = [], metadata: Raw[] = [];
  const entryPrograms = new Map<string, string>(), seen = new Set<string>();
  let archivedRows = 0, deletedRows = 0, mirrorOccurrences = 0;
  const virtualId = (archive: string, path: string) => JSON.stringify(["ARCHIVE_PLAN_ADAPTER_V1", archive, path]);
  const sourceKey = (table: string, id: string) => JSON.stringify([scope, table, id]);
  function add(table: PlanSourceTable, archive: string, client: string, path: string, raw: unknown, values: Raw): Raw & { readonly id: string } {
    const id = virtualId(archive, path), row = { ...values, id };
    tables[table]!.push(row); pointers.push({ archive, client, path, raw, virtualKey: sourceKey(table, id) }); return row;
  }
  function snapshot(value: unknown): Raw {
    const page = object(value), weeks = array(page.weeks), workouts = array(page.workouts);
    text(page.programId);
    if (page.mode !== "free" && page.mode !== "periodized") return fail("MODE_INVALID");
    if (position(page.totalWeeks) !== weeks.length || position(page.totalWorkouts) !== workouts.length) return fail("COUNTS_CONFLICT");
    if (position(page.completedWorkouts) !== workouts.filter((w) => ["completed", "done"].includes(String(object(w).status))).length) return fail("COMPLETED_COUNT_CONFLICT");
    if (page.settings !== undefined) object(page.settings);
    return page;
  }
  for (const row of [...(source.tables.training_archive_entries ?? [])].sort((a, b) => text(a.id) < text(b.id) ? -1 : text(a.id) > text(b.id) ? 1 : 0)) {
    const archive = text(row.id), client = text(row.client_id);
    if (seen.has(archive) || !clientIds.has(client)) return fail("OWNER_OR_ID_INVALID"); seen.add(archive); entries.push(row);
    if (!isExplicitTimestamp(row.archived_at) || !Object.hasOwn(row, "deleted_at")
      || row.deleted_at !== null && !isExplicitTimestamp(row.deleted_at)) return fail("LIFECYCLE_UNOBSERVED");
    if (row.deleted_at !== null) { deletedRows++; continue; }
    text(row.title);
    let parsed: unknown;
    try { parsed = typeof row.data_json === "string" ? parseRoundTripSourceJson(row.data_json) : null; }
    catch (error) { return fail(error instanceof RangeError ? "NUMBER_UNREPRESENTABLE" : "JSON_INVALID"); }
    const root = snapshot(parsed), cycles = root.cycles === undefined || root.cycles === null ? [] : array(root.cycles);
    if (cycles.length && root.mode !== "periodized") return fail("CYCLES_MODE_CONFLICT");
    const pages = cycles.length ? cycles.map((c, i) => {
      const cycle = object(c), page = snapshot(cycle.snapshot);
      if (page.mode !== "periodized" || page.cycles !== undefined && array(page.cycles).length > 0) return fail("NESTED_CYCLES_UNSUPPORTED");
      return { page, name: text(cycle.name), path: `/cycles/${i}/snapshot` };
    }) : [{ page: root, name: text(row.title), path: "" }];
    if (new Set(pages.map((p) => p.page.programId)).size !== pages.length) return fail("PAGE_IDENTITY_DUPLICATE");
    const flattenedWeeks: Raw[] = [], flattenedWorkouts: Raw[] = [];
    let offset = 0;
    for (const { page } of pages) {
      for (const w of array(page.weeks)) flattenedWeeks.push({ ...object(w), weekIndex: position(object(w).weekIndex) + offset });
      for (const w of array(page.workouts)) flattenedWorkouts.push({ ...object(w), weekIndex: position(object(w).weekIndex) + offset });
      offset += position(page.totalWeeks);
    }
    // Current v2 archive builder writes both representations. A disagreement is
    // evidence of lost or conflicting data, never permission to pick one silently.
    if (cycles.length && (canonical(root.weeks) !== canonical(flattenedWeeks) || canonical(root.workouts) !== canonical(flattenedWorkouts)
      || root.totalWeeks !== offset || root.completedWorkouts !== pages.reduce((n, p) => n + position(p.page.completedWorkouts), 0))) return fail("ROOT_CYCLE_CONFLICT");
    const book = virtualId(archive, "/book"), pagePrograms: string[] = [];
    const pagePointers: { page: Raw; path: string; pointers: readonly Pointer[] }[] = [];
    for (const [pageIndex, { page, name, path }] of pages.entries()) {
      const pointersStart = pointers.length;
      const settings = { ...(page.settings === undefined ? {} : object(page.settings)), pageIndex };
      // The snapshot is owned by the archive client. Its old source program/group
      // references are provenance; they cannot revive a live group or join clients.
      delete (settings as Record<string, unknown>).sharedGroupId;
      delete (settings as Record<string, unknown>).participantIds;
      const p = add("training_programs", archive, client, `${path}/programId`, page.programId, { client_id: client,
        mode: page.mode, name, cycle_type: page.cycleType, settings_json: JSON.stringify(settings), book_id: book, is_template: 0,
        created_at: importedAt, updated_at: importedAt, deleted_at: null }); pagePrograms.push(p.id);
      const weeks = new Map<number, Raw>();
      array(page.weeks).forEach((value, wi) => {
        const week = object(value), index = position(week.weekIndex); text(week.weekId);
        if (weeks.has(index)) return fail("WEEK_IDENTITY_DUPLICATE");
        const w = add("training_weeks", archive, client, `${path}/weeks/${wi}`, value, { program_id: p.id, week_index: index,
          week_type: week.weekType, label: week.label, data_json: JSON.stringify(week.data === undefined ? {} : object(week.data)), deleted_at: null }); weeks.set(index, w);
        if (position(week.workoutCount) !== array(page.workouts).filter((v) => object(v).weekIndex === index).length) return fail("WEEK_WORKOUT_COUNT_CONFLICT");
      });
      array(page.workouts).forEach((value, wi) => {
        const w = object(value), week = weeks.get(position(w.weekIndex)), workoutPath = `${path}/workouts/${wi}`;
        if (!week) return fail("WORKOUT_WEEK_MISSING");
        const workout = add("training_workouts", archive, client, workoutPath, value, { client_id: client, program_id: p.id, week_id: week.id,
          sort_index: w.sortIndex, name: w.name, data_json: JSON.stringify(w.data === undefined ? {} : object(w.data)),
          created_at: importedAt, updated_at: importedAt, deleted_at: null });
        array(w.exercises).forEach((value, ei) => {
          const e = object(value), data = object(e.data), exercisePath = `${workoutPath}/exercises/${ei}`;
          const refs = [e.templateExerciseId, data.catalogId].filter((v) => v !== undefined && v !== null && v !== "");
          if (!refs.length || refs.some((v) => typeof v !== "string" || !v.trim()) || new Set(refs).size !== 1) return fail("EXERCISE_REFERENCE_UNRESOLVED");
          const exerciseId = catalogIds.get(refs[0] as string); if (!exerciseId) return fail("EXERCISE_REFERENCE_UNRESOLVED");
          const exercise = add("training_exercises", archive, client, exercisePath, value, { workout_id: workout.id,
            sort_index: e.sortIndex, name: e.name, note: e.note, template_exercise_id: e.templateExerciseId ?? null, data_json: JSON.stringify(data), deleted_at: null });
          const k = sourceKey("training_exercises", exercise.id);
          links.set(k, { sourceKey: k, clientId: client, exerciseId, raw: exercise });
          array(e.sets).forEach((value, si) => {
            const set = object(value);
            add("training_set_logs", archive, client, `${exercisePath}/sets/${si}`, value, { exercise_id: exercise.id, set_index: set.setIndex,
              reps: set.reps, weight: set.weight, rpe: set.rpe, completed_at: set.completedAt, set_kind: set.setKind ?? "working",
              data_json: JSON.stringify(object(set.data)), deleted_at: null });
          });
        });
      });
      pagePointers.push({ page, path, pointers: pointers.slice(pointersStart) });
    }
    tables.training_library_programs!.push({ id: book, client_id: client, name: row.title, mode: root.mode, created_at: importedAt, archived_at: row.archived_at });
    entryPrograms.set(archive, pagePrograms[0]!); archivedRows++;
    if (cycles.length) {
      let weekOffset = 0, workoutOffset = 0;
      for (const { page, path, pointers: canonicalPointers } of pagePointers) {
        for (const pointer of canonicalPointers) {
          const suffix = pointer.path.slice(path.length), match = /^\/(weeks|workouts)\/(\d+)(.*)$/u.exec(suffix);
          if (!pointer.path.startsWith(`${path}/`) || !match) continue;
          const rootIndex = Number(match[2]) + (match[1] === "weeks" ? weekOffset : workoutOffset);
          const rootPath = `/${match[1]}/${rootIndex}${match[3]}`;
          // The raw global week index is retained at the root; aliases use the
          // same local target week as its proven cycle mirror.
          let raw: unknown = root;
          for (const part of rootPath.slice(1).split("/")) raw = Array.isArray(raw) ? raw[Number(part)] : object(raw)[part];
          pointers.push({ ...pointer, path: rootPath, raw }); mirrorOccurrences++;
        }
        weekOffset += array(page.weeks).length; workoutOffset += array(page.workouts).length;
      }
    }
    metadata.push({ sourceArchiveId: archive, client, sourceProgramIds: pages.map((p) => p.page.programId),
      pagePaths: pages.map((p) => p.path), archivePlanBasis: cycles.length ? "CYCLES_WITH_VERIFIED_ROOT_MIRROR" : "ROOT_SNAPSHOT",
      targetContainerDatesBasis: "NEW_CONTAINER_AT_IMPORT", sourceArchivedAt: row.archived_at,
      sourceGroupMembershipDisposition: "RETAINED_NOT_REACTIVATED", sourceFactDisposition: "DEFERRED_CANONICAL_EXECUTION" });
  }
  const projected = composeLegacyPlans(context, importedAt, { accountScope: scope, tables }, clientIds, links,
    (kind, key) => identity(kind, JSON.stringify([scope, "archive-plans", JSON.parse(key) as unknown])));
  const aliases = new Map(projected.sourceRows.map((r) => [r.source_key, r]));
  const sourceRows: PlanRow[] = pointers.map((pointer) => {
    const alias = aliases.get(pointer.virtualKey); if (!alias) return fail("ALIAS_MISSING");
    return { ...alias, source_key: JSON.stringify([scope, "training_archive_entries", pointer.archive, pointer.path]),
      source_table: "training_archive_entries", source_row_id: pointer.archive,
      disposition: alias.disposition === "RETAINED_WARMUP_FACT_SOURCE" ? "ARCHIVE_WARMUP_SOURCE"
        : alias.disposition === "SIMPLE_WEEK_INDEX" ? "ARCHIVE_SIMPLE_WEEK_INDEX" : "ARCHIVE_PLAN",
      source_json: canonical(pointer.raw) };
  });
  for (const row of entries) {
    const archive = text(row.id), programAlias = aliases.get(sourceKey("training_programs", entryPrograms.get(archive) ?? ""));
    sourceRows.push({ source_key: sourceKey("training_archive_entries", archive), source_table: "training_archive_entries", source_row_id: archive,
      target_client_id: clientIds.get(text(row.client_id))!, target_id: programAlias?.target_program_id ?? null,
      target_program_id: programAlias?.target_program_id ?? null, week_index: null,
      disposition: row.deleted_at === null ? "ARCHIVE_PROGRAM" : "RETAINED_DELETED_ARCHIVE_SOURCE", source_json: canonical(row) });
  }
  const pointerKeys = new Map<string, string>();
  for (const p of pointers) if (!pointerKeys.has(p.virtualKey)) pointerKeys.set(p.virtualKey, JSON.stringify([scope, "training_archive_entries", p.archive, p.path]));
  function originalBasis(value: unknown): unknown {
    if (typeof value === "string") return pointerKeys.get(value)
      ?? (value.endsWith(".rir") && pointerKeys.has(value.slice(0, -4)) ? `${pointerKeys.get(value.slice(0, -4))}.rir` : value);
    if (Array.isArray(value)) return value.map(originalBasis);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, originalBasis(v)]));
    return value;
  }
  if (projected.scopeLineages.metadata.length) metadata.push({ scopeLineageProjectionVersion: 1,
    archiveScopeLineages: originalBasis(projected.scopeLineages.metadata.map((group) => ({ status: group.status, issues: group.issues,
      sourceProgramKeys: group.sourceProgramIds.map((id) => sourceKey("training_programs", id)),
      sourceWorkoutKeys: group.sourceWorkoutIds.map((id) => sourceKey("training_workouts", id)),
      workoutAnchorKey: group.workoutAnchorId === null ? null : sourceKey("training_workouts", group.workoutAnchorId),
      exercises: group.exercises.map((e) => ({ registryExerciseId: e.catalogId, status: e.status,
        sourceExerciseKeys: e.sourceExerciseIds.map((id) => sourceKey("training_exercises", id)),
        anchorKey: e.anchorId === null ? null : sourceKey("training_exercises", e.anchorId) })),
    }))) });
  return { tables: projected.tables, sourceRows, metadata, planBases: projected.planBases.map(originalBasis),
    archivedProgramRows: archivedRows, deferredArchiveRows: deletedRows, mirroredAliasRows: mirrorOccurrences,
    targetFactsCreated: 0 as const, finalizable: false as const };
}
