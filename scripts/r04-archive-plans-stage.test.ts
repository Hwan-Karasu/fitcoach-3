import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareCandidateIdentityLedger } from "./r04/CandidateIdentityLedger.ts";
import { readLegacyPlansInSnapshot } from "./r04/LegacyPlansSourceReader.ts";
import { readLegacyClientIdentityInSnapshot } from "./r04/LegacyClientIdentitySourceReader.ts";
import { readLegacyClientCardsInSnapshot } from "./r04/LegacyClientCardProjection.ts";
import { readLegacyExerciseCatalogInSnapshot } from "./r04/LegacyExerciseCatalogSourceReader.ts";
import { readLegacyExerciseReferencesInSnapshot } from "./r04/LegacyExerciseReferencePreflight.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { readMesocycles } from "../apps/mobile/src/features/training/plans/data/PeriodizedStore.ts";
import { readSimpleWeeks } from "../apps/mobile/src/features/training/plans/data/SimpleWeekStore.ts";
import { readStructure } from "../apps/mobile/src/features/training/plans/data/SimplePlanStore.ts";

const context = { sourceSha256: "e".repeat(64), accountScope: "archive-synthetic", sourceWorkspaceId: "source-workspace", targetWorkspaceId: "local-trainer" };
const created = "2026-03-01T08:00:00Z", archived = "2026-04-01T09:00:00Z", imported = "2026-05-01T10:00:00Z";
const options = { clientIdentityRehearsal: { createdAt: imported, profiles: true as const, questionnaires: true as const,
  workData: true as const, exercises: true as const, plans: true as const, templates: true as const, archives: true as const } };
function allocator() { let n = 0; return () => `33333333-3333-4333-8333-${String(++n).padStart(12, "0")}`; }
function page(programId: string, mode: "free" | "periodized", count: number) {
  return { programId, mode, cycleType: mode === "free" ? "" : "hypertrophy",
    settings: { totalWeeks: count, repRange: "8-12", sharedGroupId: "old-shared-page", participantIds: ["a", "b"] },
    totalWeeks: count, totalWorkouts: count, completedWorkouts: count,
    weeks: Array.from({ length: count }, (_, i) => ({ weekId: `${programId}:week:${i}`, weekIndex: i, label: `Неделя ${i + 1}`,
      weekType: mode === "periodized" && i === 1 ? "heavy" : "", workoutCount: 1, data: { preserved: true } })),
    workouts: Array.from({ length: count }, (_, i) => ({ name: `Тренировка ${i + 1}`, weekIndex: i, sortIndex: 3,
      status: "completed", loadType: "old-load", colorToken: "old-color", scheduledAt: null, data: { oldAnnotation: "Сохранить" },
      exercises: [{ name: "Снимок упражнения", note: "Плановое указание", sortIndex: 2, templateExerciseId: "catalog-x",
        data: { catalogId: "catalog-x", rir: "1-2", restSeconds: 120 }, sets: [
          { sourceFactId: `${programId}:${i}:warmup`, setIndex: 0, reps: "5", weight: "0", rpe: "", setKind: "warmup",
            completedAt: null, segments: [], data: { plannedReps: "5" } },
          { sourceFactId: `${programId}:${i}:working`, setIndex: 1, reps: "20", weight: "10", rpe: "8", setKind: "working",
            completedAt: i === 0 ? archived : null, segments: [{ id: "segment-source", reps: "20", weight: "10" }],
            data: { plannedReps: mode === "free" && i === 1 ? "15" : "8-12", plannedWeight: "2,5", factCompletionExplicit: true } },
        ] }],
    })),
  };
}
function book() {
  // The old root may refer to somebody else's shared source page. It is not a
  // foreign-key invitation to import that person's plan, selection or results.
  const cycles = [{ name: "Первый цикл", snapshot: page("p-live", "periodized", 2) }, { name: "Второй цикл", snapshot: page("old-second", "periodized", 1) }];
  let offset = 0;
  const weeks: ReturnType<typeof page>["weeks"] = [], workouts: ReturnType<typeof page>["workouts"] = [];
  for (const c of cycles) {
    weeks.push(...c.snapshot.weeks.map((w) => ({ ...w, weekIndex: w.weekIndex + offset })));
    workouts.push(...c.snapshot.workouts.map((w) => ({ ...w, weekIndex: w.weekIndex + offset })));
    offset += c.snapshot.totalWeeks;
  }
  return { ...cycles[0]!.snapshot, totalWeeks: offset, totalWorkouts: workouts.length, completedWorkouts: workouts.length, weeks, workouts, cycles,
    library: { name: "Архивная книга", origin: "personal", authorId: null, permissions: {} } };
}
function seed(db: DatabaseSync) {
  db.exec(`CREATE TABLE clients(id TEXT PRIMARY KEY,workspace_id TEXT,name TEXT,created_at TEXT,updated_at TEXT,archived_at TEXT,deleted_at TEXT,birthdate TEXT,height TEXT,gender TEXT,avatar_emoji TEXT,profile_json TEXT);
    CREATE TABLE exercise_catalog(id TEXT PRIMARY KEY,name TEXT,category TEXT,equipment TEXT,aliases_json TEXT,source TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_programs(id TEXT PRIMARY KEY,client_id TEXT,mode TEXT,name TEXT,cycle_type TEXT,settings_json TEXT,book_id TEXT,is_template INTEGER,created_at TEXT,updated_at TEXT,deleted_at TEXT,template_workspace_id TEXT);
    CREATE TABLE training_weeks(id TEXT PRIMARY KEY,program_id TEXT,week_index INTEGER,week_type TEXT,label TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_workouts(id TEXT PRIMARY KEY,client_id TEXT,program_id TEXT,week_id TEXT,sort_index INTEGER,name TEXT,data_json TEXT,created_at TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_exercises(id TEXT PRIMARY KEY,workout_id TEXT,sort_index INTEGER,name TEXT,note TEXT,template_exercise_id TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_set_logs(id TEXT PRIMARY KEY,exercise_id TEXT,set_index INTEGER,reps TEXT,weight TEXT,rpe TEXT,completed_at TEXT,data_json TEXT,deleted_at TEXT,set_kind TEXT);
    CREATE TABLE training_exercise_history(id TEXT PRIMARY KEY,client_id TEXT,exercise_key TEXT,data_json TEXT,deleted_at TEXT);
    CREATE TABLE training_library_programs(id TEXT,client_id TEXT,name TEXT,mode TEXT,created_at TEXT,archived_at TEXT,PRIMARY KEY(client_id,id));
    CREATE TABLE training_workspaces(client_id TEXT PRIMARY KEY,active_program_id TEXT,week_state_json TEXT,updated_at TEXT,deleted_at TEXT);
    CREATE TABLE training_archive_entries(id TEXT PRIMARY KEY,client_id TEXT,title TEXT,data_json TEXT,archived_at TEXT,deleted_at TEXT);`);
  for (const id of ["a", "b"]) db.prepare("INSERT INTO clients VALUES(?,?,?,?,?,NULL,NULL,'','','','',?)").run(id, context.sourceWorkspaceId,
    `Синтетический ${id}`, created, created, JSON.stringify({ trainerNotes: `Заметка ${id}`, trainerTags: ["Общий"] }));
  db.prepare("INSERT INTO exercise_catalog VALUES('catalog-x','Упражнение','Другое','','[]','user',?,?,NULL)").run(created, created);
  db.prepare("INSERT INTO training_programs VALUES('p-live','b','periodized','Живой цикл','hypertrophy',?,NULL,0,?,?,NULL,NULL)").run('{"totalWeeks":1}', created, created);
  db.exec("INSERT INTO training_weeks VALUES('live-week','p-live',0,'','Неделя 1','{}',NULL)");
  db.prepare("INSERT INTO training_workspaces VALUES('b','p-live','{}',?,NULL)").run(created);
  for (const [id, title, value] of [["archive-book", "Архивная книга", book()], ["archive-simple", "Простой архив", page("old-simple", "free", 2)]] as const) {
    db.prepare("INSERT INTO training_archive_entries VALUES(?,'a',?,?,?,NULL)").run(id, title, JSON.stringify(value), archived);
  }
  db.prepare("INSERT INTO training_archive_entries VALUES('deleted-archive','a','Удалённый','{broken',?,?)").run(archived, archived);
}
function read(source: DatabaseSync) {
  const catalog = readLegacyExerciseCatalogInSnapshot(source, context.accountScope);
  return { cards: readLegacyClientCardsInSnapshot(source, context.accountScope, readLegacyClientIdentityInSnapshot(source, context.accountScope)), catalog,
    refs: readLegacyExerciseReferencesInSnapshot(source, context.accountScope, catalog), plans: readLegacyPlansInSnapshot(source, context.accountScope) };
}
function stage(source: DatabaseSync, target: DatabaseSync) {
  const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
  return { input, ledger, result: ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocator()) };
}
async function fixture(run: (source: DatabaseSync, target: DatabaseSync) => void | Promise<void>) {
  const source = new DatabaseSync(":memory:"), target = new DatabaseSync(":memory:");
  try { seed(source); await run(source, target); } finally { source.close(); target.close(); }
}
function alias(db: DatabaseSync, id: string, path?: string) {
  return db.prepare("SELECT * FROM r04_plan_source WHERE source_key=?").get(JSON.stringify([context.accountScope, "training_archive_entries", id, ...(path === undefined ? [] : [path])]))!;
}
function updateBook(db: DatabaseSync, edit: (value: ReturnType<typeof book>) => void) {
  const value = JSON.parse(db.prepare("SELECT data_json FROM training_archive_entries WHERE id='archive-book'").get()!.data_json as string) as ReturnType<typeof book>;
  edit(value); db.prepare("UPDATE training_archive_entries SET data_json=? WHERE id='archive-book'").run(JSON.stringify(value));
}
const ownedTables = ["clients", "questionnaire_versions", "questionnaire_answers", "r04_work_ids", "r04_work_notes", "r04_work_tags", "r04_work_assignments", "r04_work_receipt",
  "r04_exercise_ids", "r04_exercise_registry", "exercise_overlay", "r04_exercise_links", "r04_exercise_receipt", "r04_plan_ids", "r04_plan_source", "r04_plan_receipt",
  "training_programs", "training_program_members", "training_mesocycles", "training_weeks", "training_workouts", "training_planned_exercises", "training_planned_sets",
  "training_simple_overrides", "training_client_selection", "training_mesocycle_selection", "training_templates"];

test("archive snapshots write actual D01 archived programs and typed mesocycles, independently of referenced live owners", () => fixture(async (source, target) => {
  const { result } = stage(source, target), root = alias(target, "archive-book");
  assert.equal(result.archivedProgramRows, 2); assert.equal(result.programRows, 3); assert.equal(result.mesocycleRows, 3);
  assert.equal(result.deferredArchiveRows, 1); assert.equal(result.targetFactsCreated, 0); assert.equal(result.finalizable, false);
  assert.equal(root.disposition, "ARCHIVE_PROGRAM"); assert.equal(root.target_id, root.target_program_id);
  const member = target.prepare("SELECT * FROM training_program_members WHERE program_id=?").get(root.target_id!);
  assert.equal(member?.client_id, root.target_client_id); assert.equal(member?.archived_at, archived);
  const cycles = await readMesocycles(nodeSqlitePort(target), context.targetWorkspaceId, String(root.target_id), String(root.target_client_id));
  assert.deepEqual(cycles.map((c) => c.title), ["Первый цикл", "Второй цикл"]);
  assert.deepEqual(cycles[0]!.weeks.map((w) => w.type), ["base", "heavy"]);
  assert.deepEqual(cycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.sets.map((s) => [s.reps, s.repsMax, s.loadGrams]), [[8, 12, 2500]]);
  assert.equal(cycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.restSec, 120);
  assert.equal(cycles[0]!.weeks[0]!.workouts[0]!.exercises[0]!.instruction, "Плановое указание");
  assert.deepEqual(target.prepare("PRAGMA foreign_key_check").all(), []);
}));

test("root and cycle mirrors point to one plan entity and retain exact raw actual values and original JSON paths", () => fixture((source, target) => {
  const { result, ledger } = stage(source, target);
  const cycle = alias(target, "archive-book", "/cycles/0/snapshot/workouts/0/exercises/0/sets/1"), root = alias(target, "archive-book", "/workouts/0/exercises/0/sets/1");
  assert.ok(result.mirroredArchiveAliasRows > 0); assert.equal(root.target_id, cycle.target_id); assert.equal(root.target_program_id, cycle.target_program_id);
  const raw = JSON.parse(root.source_json as string) as Record<string, unknown>;
  assert.equal(raw.reps, "20"); assert.equal(raw.weight, "10"); assert.equal(raw.sourceFactId, "p-live:0:working"); assert.equal(raw.completedAt, archived);
  assert.equal((raw.segments as unknown[]).length, 1);
  const warmup = alias(target, "archive-book", "/workouts/0/exercises/0/sets/0");
  assert.equal(warmup.disposition, "ARCHIVE_WARMUP_SOURCE"); assert.equal(warmup.target_id, null); assert.equal(warmup.week_index, 1);
  assert.equal(target.prepare("SELECT count(*) AS n FROM training_planned_sets").get()?.n, 4); // 3 cycle slots + SIMPLE base; its week2 is an override.
  assert.equal(target.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='training_sessions'").get()?.n, 0);
  assert.ok([...ledger.loadPlanDraftMappings().values()].some((r) => r.sourceTable === "training_archive_entries"));
}));

test("flattened global week offsets preserve cycle-local target week context without guessing a fact identity", () => fixture((source, target) => {
  stage(source, target);
  const root = alias(target, "archive-book", "/workouts/2"), cycle = alias(target, "archive-book", "/cycles/1/snapshot/workouts/0");
  assert.equal(root.target_id, cycle.target_id); assert.equal(root.week_index, 1);
  assert.equal((JSON.parse(root.source_json as string) as Record<string, unknown>).weekIndex, 2);
  assert.equal((JSON.parse(cycle.source_json as string) as Record<string, unknown>).weekIndex, 0);
}));

test("simple archived programs retain differing prescriptions in real weekly overrides", () => fixture(async (source, target) => {
  stage(source, target); const root = alias(target, "archive-simple"), tx = nodeSqlitePort(target);
  const base = await readStructure(tx, context.targetWorkspaceId, String(root.target_id), 2);
  const weeks = await readSimpleWeeks(tx, context.targetWorkspaceId, String(root.target_client_id), String(root.target_id), base);
  assert.equal(weeks.length, 2); assert.equal(weeks[0]!.workouts[0]!.exercises[0]!.sets[0]!.reps, 8); assert.equal(weeks[1]!.workouts[0]!.exercises[0]!.sets[0]!.reps, 15);
  assert.equal(weeks[0]!.workouts[0]!.id, weeks[1]!.workouts[0]!.id);
  assert.notEqual(weeks[0]!.workouts[0]!.exercises[0]!.sets[0]!.id, weeks[1]!.workouts[0]!.exercises[0]!.sets[0]!.id);
}));

test("archives never become selected and an old shared source reference cannot restore another client's membership", () => fixture((source, target) => {
  stage(source, target); const selected = target.prepare("SELECT * FROM training_client_selection").all(); assert.equal(selected.length, 1);
  const root = alias(target, "archive-book"), member = target.prepare("SELECT * FROM training_program_members WHERE program_id=?").all(root.target_id!);
  assert.equal(member.length, 1); assert.equal(member[0]!.client_id, root.target_client_id); assert.notEqual(selected[0]!.client_id, root.target_client_id);
  assert.equal(target.prepare("SELECT count(*) AS n FROM training_mesocycle_selection WHERE program_id=?").get(root.target_id!)?.n, 0);
  const ids = target.prepare("SELECT lineage_id FROM training_mesocycles").all().map((r) => r.lineage_id); assert.equal(new Set(ids).size, ids.length);
}));

test("source archived time is retained while reconstructed container creation explicitly uses import time", () => fixture((source, target) => {
  stage(source, target); const root = alias(target, "archive-book"), program = target.prepare("SELECT * FROM training_programs WHERE id=?").get(root.target_id!);
  assert.equal(program?.created_at, imported); assert.equal(program?.updated_at, imported);
  assert.equal(target.prepare("SELECT archived_at FROM training_program_members WHERE program_id=?").get(root.target_id!)?.archived_at, archived);
  const manifest = target.prepare("SELECT target_json FROM r04_plan_receipt").get()!.target_json as string;
  assert.ok(manifest.includes("NEW_CONTAINER_AT_IMPORT")); assert.ok(manifest.includes("DEFERRED_CANONICAL_EXECUTION"));
  const saved = JSON.parse(manifest) as { planBases: string[] }, bases = saved.planBases.map((value) => JSON.parse(value) as { sourceKey: string });
  assert.ok(bases.length > 0); assert.ok(bases.every((basis) => basis.sourceKey.includes("training_archive_entries")));
  assert.equal(JSON.stringify(bases).includes("ARCHIVE_PLAN_ADAPTER_V1"), false);
}));

test("deleted archives preserve even unreadable payloads without reviving programs", () => fixture((source, target) => {
  stage(source, target); const row = alias(target, "deleted-archive");
  assert.equal(row.disposition, "RETAINED_DELETED_ARCHIVE_SOURCE"); assert.equal(row.target_id, null);
  assert.equal((JSON.parse(row.source_json as string) as Record<string, unknown>).data_json, "{broken");
}));

test("absence of the optional archive table creates no guessed archive containers or IDs", () => fixture((source, target) => {
  source.exec("DROP TABLE training_archive_entries"); const { result, ledger } = stage(source, target);
  assert.equal(result.archivedProgramRows, 0); assert.equal(result.deferredArchiveRows, 0); assert.equal(result.programRows, 1);
  assert.equal([...ledger.loadPlanDraftMappings().values()].some((r) => r.sourceTable === "training_archive_entries"), false);
}));

test("a root/cycle disagreement blocks every owner instead of selecting a convenient snapshot", async () => {
  for (const edit of [(v: ReturnType<typeof book>) => { v.workouts[0]!.exercises[0]!.sets[1]!.weight = "11"; },
    (v: ReturnType<typeof book>) => { v.workouts[2]!.weekIndex = 0; },
    (v: ReturnType<typeof book>) => { v.cycles[1]!.snapshot.workouts[0]!.name = "Иная тренировка"; }]) await fixture((source, target) => {
      updateBook(source, edit); const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
      assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocator()), /ROOT_CYCLE_CONFLICT/u);
      for (const table of ownedTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    });
});

test("archive shape, ownership, count and explicit catalog errors do not become repaired empty snapshots", async () => {
  const statements = ["UPDATE training_archive_entries SET data_json='{broken' WHERE id='archive-book'",
    "UPDATE training_archive_entries SET client_id='foreign' WHERE id='archive-book'",
    "UPDATE training_archive_entries SET archived_at='2026-04-01' WHERE id='archive-book'",
    "UPDATE training_archive_entries SET data_json=json_remove(data_json,'$.workouts') WHERE id='archive-book'",
    "UPDATE training_archive_entries SET data_json=json_set(data_json,'$.totalWorkouts',100) WHERE id='archive-book'",
    "UPDATE training_archive_entries SET data_json=json_set(data_json,'$.workouts[0].exercises[0].data.catalogId','foreign') WHERE id='archive-simple'",
    "UPDATE training_archive_entries SET data_json=json_remove(data_json,'$.workouts[0].exercises[0].templateExerciseId','$.workouts[0].exercises[0].data.catalogId') WHERE id='archive-simple'",
    "ALTER TABLE training_archive_entries DROP COLUMN deleted_at"];
  for (const sql of statements) await fixture((source, target) => {
    source.exec(sql); const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options);
    assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocator()), /ARCHIVE_PLANS_/u);
    for (const table of ownedTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
  });
});

test("same-named archive entries remain separate programs and source paths cannot collide with a live legacy row ID", () => fixture((source, target) => {
  source.exec("INSERT INTO training_archive_entries SELECT 'another-archive',client_id,title,data_json,archived_at,deleted_at FROM training_archive_entries WHERE id='archive-book'");
  const ambiguousId = JSON.stringify(["ARCHIVE_PLAN_ADAPTER_V1", "archive-book", "/cycles/0/snapshot/workouts/0"]);
  source.prepare("INSERT INTO training_workouts VALUES(?,'b','p-live','live-week',0,'Живая тренировка','{}',?,?,NULL)").run(ambiguousId, created, created);
  const { result } = stage(source, target); assert.equal(result.archivedProgramRows, 3);
  assert.notEqual(alias(target, "archive-book").target_id, alias(target, "another-archive").target_id);
  const ids = target.prepare("SELECT target_id FROM r04_plan_ids").all().map((r) => r.target_id); assert.equal(new Set(ids).size, ids.length);
  const live = target.prepare("SELECT target_id FROM r04_plan_source WHERE source_key=?").get(JSON.stringify([context.accountScope, "training_workouts", ambiguousId]));
  assert.notEqual(live?.target_id, alias(target, "archive-book", "/cycles/0/snapshot/workouts/0").target_id);
}));

test("all 16 shared transaction boundaries including archive allocation roll back every owner and permit clean retry", async () => {
  for (const [phase, occurrence] of [["after-archive-plans", 1], ["after-plan-ids", 1], ...Array.from({ length: 11 }, (_, n) => ["after-plan-rows", n + 1] as const),
    ["after-plan-source", 1], ["after-plan-receipt", 1], ["before-commit", 1]] as const) await fixture((source, target) => {
    const input = read(source), ledger = prepareCandidateIdentityLedger(target, context, options); let seen = 0;
    assert.throws(() => ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocator(), (stage) => {
      if (stage === phase && ++seen === occurrence) throw new Error("injected");
    }), /WRITE_FAILED/u);
    for (const table of ownedTables) assert.equal(target.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n, 0, table);
    assert.equal(ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocator()).archivedProgramRows, 2);
  });
});

test("old template jobs cannot be claimed by archive mode and archive mode cannot omit its owner dependencies", () => fixture((source, target) => {
  const prior = { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, archives: undefined } };
  const input = read(source); prepareCandidateIdentityLedger(target, context, prior).stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocator());
  assert.throws(() => prepareCandidateIdentityLedger(target, context, options), /CONTEXT_MISMATCH/u);
  const empty = new DatabaseSync(":memory:");
  try { assert.throws(() => prepareCandidateIdentityLedger(empty, context, { clientIdentityRehearsal: { ...options.clientIdentityRehearsal, templates: undefined } }), /CONTEXT_INVALID/u); }
  finally { empty.close(); }
}));

test("archive aliases verify target parity and a changed historical snapshot never overwrites a committed plan", () => fixture((source, target) => {
  const { input, ledger } = stage(source, target), root = alias(target, "archive-book");
  target.prepare("UPDATE training_programs SET title='Изменённый архив' WHERE id=?").run(root.target_id!);
  assert.throws(() => ledger.loadPlanDraftMappings(), /PARITY_MISMATCH/u);
  target.prepare("UPDATE training_programs SET title='Архивная книга' WHERE id=?").run(root.target_id!); assert.ok(ledger.loadPlanDraftMappings().size > 0);
  source.exec("UPDATE training_archive_entries SET title='Иное имя' WHERE id='archive-book'"); const changed = read(source);
  assert.throws(() => ledger.stageClientPlans(changed.cards, null, changed.catalog, changed.refs, changed.plans, allocator()), /PARITY_MISMATCH/u);
  assert.equal(ledger.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, () => { throw new Error("reuse IDs"); }).archivedProgramRows, 2);
}));

test("archive plans, mirror aliases and all IDs survive read-only source, target reopen and reordered byte-identical retry", () => {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-archive-plans-")), sourcePath = join(dir, "source.db"), targetPath = join(dir, "stage.db");
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  let source: DatabaseSync | null = null, target: DatabaseSync | null = null;
  try {
    source = new DatabaseSync(sourcePath); seed(source); source.close(); source = null; const sourceHash = hash(sourcePath);
    source = new DatabaseSync(sourcePath, { readOnly: true }); source.exec("PRAGMA query_only=ON; BEGIN"); const input = read(source), exact = { ...context, sourceSha256: sourceHash };
    target = new DatabaseSync(targetPath); const first = prepareCandidateIdentityLedger(target, exact, options);
    first.stageClientPlans(input.cards, null, input.catalog, input.refs, input.plans, allocator()); const aliases = [...first.loadPlanDraftMappings()];
    target.close(); target = null; const targetHash = hash(targetPath); target = new DatabaseSync(targetPath);
    for (const rows of Object.values(input.plans.tables)) if (rows !== null) (rows as unknown[]).reverse();
    const reopened = prepareCandidateIdentityLedger(target, exact, options);
    const result = reopened.stageClientPlans([...input.cards].reverse(), null, [...input.catalog].reverse(), [...input.refs].reverse(), input.plans, () => { throw new Error("reuse IDs"); });
    assert.equal(result.archivedProgramRows, 2); assert.deepEqual([...reopened.loadPlanDraftMappings()], aliases);
    target.close(); target = null; assert.equal(hash(targetPath), targetHash);
    source.exec("ROLLBACK"); source.close(); source = null; assert.equal(hash(sourcePath), sourceHash);
  } finally { target?.close(); source?.close(); rmSync(dir, { recursive: true, force: true }); }
});
