import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createSqliteBackup, prepareBackupForRestore } from "./r06/SqliteBackup.ts";
import { readTrainingWorkbook, readWorkbook, writeTrainingWorkbook } from "../apps/mobile/src/features/import/data/TrainingWorkbook.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository } from "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { DevTrainingExecutionRepository } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { createTrainingTransfer } from "../apps/mobile/src/app/composition/createTrainingTransfer.ts";
import { DevExerciseCatalogRepository } from "../apps/mobile/src/features/exercises/data/DevExerciseCatalogRepository.ts";
import type { SystemCatalog } from "../apps/mobile/src/features/exercises/domain/ExerciseModel.ts";
import { trainingTransferFixture } from "./training-transfer-fixture.ts";
import { previousWeekQueries } from "../apps/mobile/src/features/training/execution/domain/PreviousWeekQueries.ts";
import { importTrainingExecutions } from "../apps/mobile/src/features/training/execution/data/TrainingExecutionTransfer.ts";
import { flattenLegacyMatrix } from "../apps/mobile/src/features/import/domain/LegacyMatrix.ts";
import { detectLegacyMapping, normalizeLegacyTable } from "../apps/mobile/src/features/import/domain/LegacyExcel.ts";
import { correctTransferIssue } from "../apps/mobile/src/features/import/domain/IssueCorrections.ts";
import { TRANSFER_OWNER } from "../apps/mobile/src/features/import/data/TransferReceiptStore.ts";
import { ExerciseImportMatchStore } from "../apps/mobile/src/features/import/data/ExerciseImportMatchStore.ts";
import { runMigrationsInTransaction } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { startWorkbookReview, setWorkbookNameMatch, workbookMatchesToRemember, selectWorkbookImportSheets } from "../apps/mobile/src/features/import/domain/WorkbookReviewSession.ts";
import type { TrainingTransfer } from "../apps/mobile/src/shared/training-transfer/TrainingTransfer.ts";
import { weekStatus } from "../apps/mobile/src/features/training/execution/domain/ExecutionRules.ts";
import { reidTransfer, transferSourceIds } from "../apps/mobile/src/features/import/domain/TransferIds.ts";
import { builderWorkbookImport } from "../apps/mobile/src/features/import/domain/BuilderWorkbookImport.ts";
import type { BuilderWorkbookSaveRequest } from "../apps/mobile/src/features/training/plans/domain/BuilderWorkbookSave.ts";
import type { MesocycleBuilderDraft } from "../apps/mobile/src/features/training/plans/domain/PeriodizedDraft.ts";
import { prepareWholeWorkbook, compileWholeWorkbook } from "../apps/mobile/src/features/import/domain/WholeWorkbookImport.ts";
import { SCHEMA_OWNERS } from "../apps/mobile/src/app/composition/schema.ts";
import { devTrainingExecutionCatalog, DEV_TRAINING_EXECUTION_LEDGER } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionCatalog.ts";
import { devTrainingPlansCatalog, DEV_TRAINING_PLANS_LEDGER } from "../apps/mobile/src/features/training/plans/data/DevTrainingPlansCatalog.ts";
import { plansIntegrityMigration } from "../apps/mobile/src/features/training/plans/data/PlansIntegrityMigration.ts";

/** Идентификаторы по порядку первого появления: сравнение структуры и значений без привязки к случайным UUID нового движка. */
function anonymizeIds<T>(value: T): T {
  const tokens = new Map<string, string>();
  const walk = (item: unknown, key = ""): unknown => {
    if (Array.isArray(item)) return item.map((entry) => walk(entry, key));
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)).map(([k, v]) => [k, walk(v, k)]));
    if (typeof item === "string" && key !== "exerciseId" && /(^id$|Id$)/u.test(key)) { if (!tokens.has(item)) tokens.set(item, "#" + (tokens.size + 1)); return tokens.get(item); }
    return item;
  };
  return walk(value) as T;
}
/** Тот же перенос без смены идентификаторов: ожидаемый результат для сравнения. */
const sameIds = (value: TrainingTransfer, clientId: string, mapping: Readonly<Record<string, string>>) =>
  reidTransfer(value, clientId, mapping, new Map(transferSourceIds(value).map((id) => [id, id])));
const bySlot = <T extends { weekIndex: number }>(sessions: readonly T[]) => [...sessions].sort((a, b) => a.weekIndex - b.weekIndex);

function multiBook(targetId: string) {
  const base = trainingTransferFixture(); const p = base.programs[0]!; const cycle = p.mesocycles[0]!;
  const value = { ...base, programs: [{ ...p, mesocycles: [0, 1, 2].map((n) => ({ ...cycle, id: `cycle:${n}`, title: `Цикл ${n + 1}`,
    weeks: cycle.weeks.map((w) => ({ ...w, workouts: w.workouts.map((x) => ({ ...x, id: `${n}:${x.id}` })) })) })) }],
    sessions: [0, 1, 2].flatMap((n) => base.sessions.map((s) => ({ ...s, id: `${n}:${s.id}`, plannedWorkoutId: `${n}:${s.plannedWorkoutId}` }))) };
  return setWorkbookNameMatch(prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value }, false), []), base.exercises[0]!.name, targetId);
}

test("I07 selected workbook cycles and their results save atomically with a manual draft and survive reopening", async () => {
  const f = await fixture();
  try {
    const imported = builderWorkbookImport(multiBook(f.mapping.press!));
    const manual = { key: "manual", title: "Мой цикл", weeks: trainingTransferFixture().programs[0]!.mesocycles[0]!.weeks.map((w) => ({ type: w.type,
      workouts: w.workouts.map((x) => ({ ...x, exercises: x.exercises.map((e) => ({ ...e, exerciseId: f.mapping.press! })) })) })) };
    const other = await f.clients.create({ displayName: "Другой синтетический участник" });
    const cycles = [manual, ...imported.cycles!]; const scope = { programId: null, mesocycleId: null };
    const draft: MesocycleBuilderDraft = { baseRevision: null, baseWeeks: null, programTitle: "Книга", title: manual.title, cycleType: "custom", repsText: "", startDate: "",
      weeks: manual.weeks, editing: 1, members: [f.client.id, other.id], workbook: { version: 1, cycles, activeKey: manual.key } };
    await f.plans.saveMesocycleBuilderDraft(f.client.id, scope, draft);
    assert.deepEqual(await f.plans.getMesocycleBuilderDraft(f.client.id, scope), JSON.parse(JSON.stringify(draft)));
    const request: BuilderWorkbookSaveRequest = { clientId: f.client.id, scope, expectedRevision: null, programTitle: "Книга", cycles,
      clientIds: [f.client.id, other.id], existingCycleKey: null, placements: [] };
    f.native.exec("CREATE TRIGGER i07_failure BEFORE INSERT ON training_mesocycles WHEN NEW.title='Цикл 2' BEGIN SELECT RAISE(ABORT, 'I07_FAILURE'); END");
    await assert.rejects(f.transfer.saveBuilderWorkbook(request), /I07_FAILURE/);
    for (const table of ["training_programs", "training_mesocycles", "training_sessions", "training_transfer_receipts", "training_import_exercise_matches"]) assert.equal(f.native.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
    assert.deepEqual(await f.plans.getMesocycleBuilderDraft(f.client.id, scope), JSON.parse(JSON.stringify(draft)));
    f.native.exec("DROP TRIGGER i07_failure");
    const result = await f.transfer.saveBuilderWorkbook(request);
    const reopened = new DevTrainingPlansRepository(f.database, "local-trainer"); await reopened.initialize();
    try {
      const plan = await reopened.getPeriodizedPlan(f.client.id, result.programId);
      assert.deepEqual(plan!.mesocycles.map((c) => c.title), ["Мой цикл", "Цикл 1", "Цикл 2", "Цикл 3"]);
      assert.equal((await reopened.getPeriodizedPlan(other.id, result.programId))!.mesocycles.length, 4);
      assert.equal(await reopened.getMesocycleBuilderDraft(f.client.id, scope), null);
    } finally { await reopened.close(); }
    // Третья неделя каждого листа без записей не начата (ADR-043): занятий для неё нет, статусов 3 листа × 2 недели.
    assert.equal((await f.execution.getProgramStatuses(f.client.id, result.programId)).length, 6);
    assert.ok((await f.execution.getProgramStatuses(f.client.id, result.programId)).every((s) => s.status === "COMPLETED"));
    assert.equal((await f.execution.getProgramStatuses(other.id, result.programId)).length, 0, "other clients receive only plans");
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_performed_sets").get()!.n, 6);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_import_exercise_matches").get()!.n, 1);
    // Повтор разрешён (решение владельца 2026-10-27): то же сохранение создаёт новую программу, прежняя остаётся нетронутой.
    const again = await f.transfer.saveBuilderWorkbook(request);
    assert.notEqual(again.programId, result.programId);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 2);
    assert.equal((await f.plans.getPeriodizedPlan(f.client.id, result.programId))!.mesocycles.length, 4);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_transfer_receipts").get()!.n, 0, "the builder keeps no receipts");
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("I07 importing additional sheets into the same programme appends them, repeats included, and never touches saved cycles", async () => {
  const f = await fixture();
  try {
    const full = multiBook(f.mapping.press!);
    const first = builderWorkbookImport(selectWorkbookImportSheets(full, ["0"]));
    const input: BuilderWorkbookSaveRequest = { clientId: f.client.id, scope: { programId: null, mesocycleId: null }, expectedRevision: null,
      programTitle: "Выбор", cycles: first.cycles!, clientIds: [f.client.id], existingCycleKey: null, placements: [] };
    const created = await f.transfer.saveBuilderWorkbook(input);
    const library = () => f.plans.getProgram(f.client.id, created.programId);
    const titles = async () => (await f.plans.getPeriodizedPlan(f.client.id, created.programId))!.mesocycles.map((c) => c.title);
    const savedFirst = (await f.plans.getPeriodizedPlan(f.client.id, created.programId))!.mesocycles[0]!;
    f.native.prepare("UPDATE training_mesocycles SET title='Локальная правка' WHERE id=?").run(created.mesocycleId);
    const append = { ...input, scope: { programId: created.programId, mesocycleId: null }, expectedRevision: (await library())!.revision, cycles: builderWorkbookImport(full).cycles! };
    await f.transfer.saveBuilderWorkbook(append);
    // Все три выбранных листа добавлены, в том числе уже импортированный первый: повтор разрешён. Сохранённые циклы и их правки не тронуты.
    assert.deepEqual(await titles(), ["Локальная правка", "Цикл 1", "Цикл 2", "Цикл 3"]);
    assert.equal(savedFirst.id, (await f.plans.getPeriodizedPlan(f.client.id, created.programId))!.mesocycles[0]!.id);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_performed_sets").get()!.n, 8);
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("I07 editing an existing cycle and adding imported sheets preserves result-removal safeguards and one transaction", async () => {
  const f = await fixture();
  try {
    const book = multiBook(f.mapping.press!); const first = builderWorkbookImport(selectWorkbookImportSheets(book, ["0"]));
    const base: BuilderWorkbookSaveRequest = { clientId: f.client.id, scope: { programId: null, mesocycleId: null }, expectedRevision: null,
      programTitle: "Правка", cycles: first.cycles!, clientIds: [f.client.id], existingCycleKey: null, placements: [] };
    const created = await f.transfer.saveBuilderWorkbook(base); const plan = (await f.plans.getPeriodizedPlan(f.client.id, created.programId))!;
    const cycle = plan.mesocycles[0]!; const additional = builderWorkbookImport(selectWorkbookImportSheets(book, ["1"]));
    const request: BuilderWorkbookSaveRequest = { ...base, scope: { programId: created.programId, mesocycleId: cycle.id }, expectedRevision: plan.program.revision,
      existingCycleKey: "existing", cycles: [{ key: "existing", title: "Изменённый цикл", settings: cycle,
        weeks: cycle.weeks.map((w) => ({ type: w.type, workouts: w.index === 1 ? [] : w.workouts })) }, ...additional.cycles!] };
    const before = f.native.prepare("SELECT * FROM training_performed_sets ORDER BY id").all();
    await assert.rejects(f.transfer.saveBuilderWorkbook(request), /WEEK_HAS_RESULTS/);
    assert.equal((await f.plans.getPeriodizedPlan(f.client.id, created.programId))!.mesocycles.length, 1);
    assert.deepEqual(f.native.prepare("SELECT * FROM training_performed_sets ORDER BY id").all(), before);
    await f.transfer.saveBuilderWorkbook({ ...request, resultsAction: "KEEP_HISTORY" });
    assert.deepEqual((await f.plans.getPeriodizedPlan(f.client.id, created.programId))!.mesocycles.map((c) => c.title), ["Изменённый цикл", "Цикл 2"]);
    assert.ok(f.native.prepare("SELECT count(*) AS n FROM training_sessions WHERE plan_deleted_at IS NOT NULL").get()!.n as number > 0);
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("I07 legacy drafts survive the guard migration and failed migrations restore their rows and guards", async () => {
  const f = await fixture();
  try {
    const c = builderWorkbookImport(multiBook(f.mapping.press!)).cycles![0]!;
    const legacy: MesocycleBuilderDraft = { baseRevision: null, baseWeeks: null, programTitle: "Старый черновик", title: "Цикл", cycleType: "custom", repsText: "", startDate: "", weeks: c.weeks, editing: 1, members: [f.client.id] };
    const scope = { programId: null, mesocycleId: null };
    await f.plans.saveMesocycleBuilderDraft(f.client.id, scope, legacy);
    f.native.exec("DROP TRIGGER training_builder_drafts_json_shape_insert; DROP TRIGGER training_builder_drafts_json_shape_update");
    for (const sql of plansIntegrityMigration.statements.filter((s) => s.startsWith("CREATE TRIGGER training_builder_drafts_json_shape"))) f.native.exec(sql);
    // Состояние «до v4»: журнал без v4 и всех последующих (v5 отдыха по типу цикла появилась позже теста).
    f.native.exec("DELETE FROM training_plans_schema_migrations WHERE version>=4");
    const rows = () => f.native.prepare("SELECT * FROM training_builder_drafts ORDER BY draft_key").all();
    const guards = () => f.native.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name LIKE 'training_builder_drafts_json_shape%' ORDER BY name").all();
    const before = rows(); const beforeGuards = guards();
    const failing = devTrainingPlansCatalog.map((s) => s.version === 4 ? { ...s, statements: [...s.statements, "INSERT INTO i07_missing_table VALUES(1)"] } : s);
    await assert.rejects(nodeSqlitePort(f.native).exclusive((tx) => runMigrationsInTransaction(tx, failing, DEV_TRAINING_PLANS_LEDGER)));
    assert.deepEqual(rows(), before); assert.deepEqual(guards(), beforeGuards);
    await nodeSqlitePort(f.native).exclusive((tx) => runMigrationsInTransaction(tx, devTrainingPlansCatalog, DEV_TRAINING_PLANS_LEDGER));
    assert.deepEqual(rows(), before); assert.deepEqual(await f.plans.getMesocycleBuilderDraft(f.client.id, scope), JSON.parse(JSON.stringify(legacy)));
    await f.plans.saveMesocycleBuilderDraft(f.client.id, scope, { ...legacy, workbook: { version: 1, cycles: [c], activeKey: c.key } });
    assert.throws(() => f.native.prepare("UPDATE training_builder_drafts SET draft_json=json_set(draft_json,'$.workbook.version',99)").run(), /TRAINING_JSON_INVALID/);
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("I07 simple draft promotion is atomic and refuses to overwrite an existing extended draft", async () => {
  const f = await fixture();
  try {
    const cycles = builderWorkbookImport(multiBook(f.mapping.press!)).cycles!;
    const simple = { title: "Моя простая", plan: { weeks: 3, workouts: cycles[0]!.weeks[0]!.workouts } };
    await f.plans.saveBuilderDraft(f.client.id, "new:SIMPLE", null, simple);
    const next: MesocycleBuilderDraft = { baseRevision: null, baseWeeks: null, programTitle: simple.title, title: cycles[0]!.title, cycleType: "custom", repsText: "", startDate: "",
      weeks: cycles[0]!.weeks, editing: 0, members: [f.client.id], workbook: { version: 1, cycles, activeKey: cycles[0]!.key } };
    await f.plans.promoteSimpleBuilderDraft(f.client.id, next);
    assert.equal(await f.plans.getBuilderDraft(f.client.id, "new:SIMPLE"), null);
    const scope = { programId: null, mesocycleId: null };
    assert.deepEqual(await f.plans.getMesocycleBuilderDraft(f.client.id, scope), JSON.parse(JSON.stringify(next)));
    await f.plans.saveBuilderDraft(f.client.id, "new:SIMPLE", null, simple);
    await assert.rejects(f.plans.promoteSimpleBuilderDraft(f.client.id, next), /PERIODIZED_DRAFT_EXISTS/);
    assert.ok(await f.plans.getBuilderDraft(f.client.id, "new:SIMPLE"));
    assert.deepEqual(await f.plans.getMesocycleBuilderDraft(f.client.id, scope), JSON.parse(JSON.stringify(next)));
  } finally { await f.close(); }
});

test("I07 native backup preserves selected cycles, current week and imported facts of an unpublished workbook draft", async () => {
  const f = await fixture(); const dir = mkdtempSync(join(tmpdir(), "i07-draft-backup-"));
  try {
    const cycles = builderWorkbookImport(multiBook(f.mapping.press!)).cycles!;
    const draft: MesocycleBuilderDraft = { baseRevision: null, baseWeeks: null, programTitle: "Черновик книги", title: cycles[1]!.title, cycleType: "custom", repsText: "", startDate: "",
      weeks: cycles[1]!.weeks, editing: 2, members: [f.client.id], workbook: { version: 1, cycles, activeKey: cycles[1]!.key } };
    await f.plans.saveMesocycleBuilderDraft(f.client.id, { programId: null, mesocycleId: null }, draft);
    const destination = join(dir, "draft.atbackup"); const staging = join(dir, "stage.db");
    await createSqliteBackup(f.native, join(dir, "partial.db"), destination, { backupId: randomUUID(), createdAt: new Date().toISOString() });
    await prepareBackupForRestore(destination, staging);
    const restored = new DatabaseSync(staging);
    try {
      assert.deepEqual(JSON.parse(String(restored.prepare("SELECT draft_json FROM training_builder_drafts").get()!.draft_json)), JSON.parse(JSON.stringify(draft)));
      assert.equal(restored.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 0);
    } finally { restored.close(); }
  } finally { await f.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("I07 sheets imported from the programme chooser are not remembered: the builder adds every selected sheet", async () => {
  const f = await fixture();
  try {
    const review = multiBook(f.mapping.press!); const first = selectWorkbookImportSheets(review, ["0"]);
    const full = compileWholeWorkbook(first);
    await f.transfer.importClient(f.client.id, full.value, full.mapping);
    const p = (await f.plans.getLibrary(f.client.id)).active[0]!;
    await f.transfer.saveBuilderWorkbook({ clientId: f.client.id, scope: { programId: p.id, mesocycleId: null }, expectedRevision: p.revision,
      programTitle: p.title, cycles: builderWorkbookImport(review).cycles!, existingCycleKey: null, clientIds: [f.client.id], placements: [] });
    // Повтор разрешён (решение владельца 2026-10-27), привязок листов библиотека не хранит: первый лист уже есть, конструктор добавляет все три.
    assert.equal((await f.plans.getPeriodizedPlan(f.client.id, p.id))!.mesocycles.length, 4);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_performed_sets").get()!.n, 8);
  } finally { await f.close(); }
});

test("I07 sheet binding migration preserves old programme receipts and rolls back on failure", async () => {
  const f = await fixture();
  try {
    // Квитанции прежних импортов остаются в базе (движок их больше не пишет и не читает): кладём такую напрямую.
    f.native.prepare("INSERT INTO training_transfer_receipts(workspace_id,client_id,source_key,source_hash,local_hash,program_ids_json,cycle_id) VALUES(?,?,?,?,?,?,NULL)")
      .run("local-trainer", f.client.id, "old-program-key", "old-source-hash", "old-local-hash", "[]");
    f.native.exec("DELETE FROM training_transfer_receipts WHERE cycle_id IS NOT NULL; ALTER TABLE training_transfer_receipts DROP COLUMN cycle_id; DELETE FROM training_transfer_schema_migrations WHERE version=3");
    const rows = () => f.native.prepare("SELECT workspace_id,client_id,source_key,source_hash,local_hash,program_ids_json FROM training_transfer_receipts ORDER BY source_key").all();
    const before = rows();
    const failing = TRANSFER_OWNER.chain.map((s) => s.version === 3 ? { ...s, statements: [...s.statements, "INSERT INTO i07_missing VALUES(1)"] } : s);
    await assert.rejects(nodeSqlitePort(f.native).exclusive((tx) => runMigrationsInTransaction(tx, failing, TRANSFER_OWNER.ledger)));
    assert.deepEqual(rows(), before); assert.ok(!f.native.prepare("PRAGMA table_info(training_transfer_receipts)").all().some((c) => c.name === "cycle_id"));
    await nodeSqlitePort(f.native).exclusive((tx) => runMigrationsInTransaction(tx, TRANSFER_OWNER.chain, TRANSFER_OWNER.ledger));
    assert.deepEqual(rows(), before); assert.equal(f.native.prepare("SELECT cycle_id FROM training_transfer_receipts").get()!.cycle_id, null);
  } finally { await f.close(); }
});

test("I07 participant copies use one destination programme for all imported cycles and never copy actual results", async () => {
  const f = await fixture();
  try {
    const other = await f.clients.create({ displayName: "Другой участник книги" });
    const cycles = builderWorkbookImport(multiBook(f.mapping.press!)).cycles!;
    const saved = await f.transfer.saveBuilderWorkbook({ clientId: f.client.id, scope: { programId: null, mesocycleId: null }, expectedRevision: null,
      programTitle: "Копии книги", cycles, existingCycleKey: null, clientIds: [f.client.id, other.id], placements: [{ clientId: other.id, target: { kind: "new" } }] });
    const library = await f.plans.getLibrary(other.id); assert.equal(library.active.length, 1);
    const targetId = library.active[0]!.id; assert.notEqual(targetId, saved.programId);
    assert.equal((await f.plans.getPeriodizedPlan(other.id, targetId))!.mesocycles.length, 3);
    assert.equal((await f.execution.getProgramStatuses(other.id, targetId)).length, 0);
    assert.equal((await f.execution.getProgramStatuses(f.client.id, saved.programId)).length, 6, "week 3 of every sheet has no records and stays not started");
  } finally { await f.close(); }
});

test("I05 whole workbook writes one programme with all cycles, plans and results atomically; a repeat creates a new programme", async () => {
  const f = await fixture();
  try {
    const base = trainingTransferFixture(); const cycle = base.programs[0]!.mesocycles[0]!;
    const value = { ...base, programs: [{ ...base.programs[0]!, mesocycles: [cycle, { ...cycle, id: "second", title: "Второй цикл",
      weeks: cycle.weeks.map((w) => ({ ...w, workouts: w.workouts.map((item) => ({ ...item, id: `second:${item.id}` })) })) }] }],
      sessions: [...base.sessions, ...base.sessions.map((s) => ({ ...s, id: `second:${s.id}`, plannedWorkoutId: `second:${s.plannedWorkoutId}` }))] };
    let session = prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value }, false), []);
    session = setWorkbookNameMatch(session, base.exercises[0]!.name, f.mapping.press!);
    const whole = compileWholeWorkbook(session);
    const matches = workbookMatchesToRemember(session, true);
    f.native.exec("CREATE TRIGGER fail_second_cycle BEFORE INSERT ON training_mesocycles WHEN NEW.title = 'Второй цикл' BEGIN SELECT RAISE(ABORT, 'test whole book rollback'); END");
    await assert.rejects(f.transfer.importClient(f.client.id, whole.value, whole.mapping, { rememberMatches: matches }), /rollback/);
    for (const table of ["training_programs", "training_mesocycles", "training_sessions", "training_performed_sets", "training_import_exercise_matches"]) {
      assert.equal(f.native.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, table);
    }
    f.native.exec("DROP TRIGGER fail_second_cycle");
    await f.transfer.importClient(f.client.id, whole.value, whole.mapping, { rememberMatches: matches });
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 1);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_mesocycles").get()!.n, 2);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_sessions").get()!.n, 4, "weeks without records get no sessions");
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_performed_sets").get()!.n, 4);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_planned_sets").get()!.n, 12);
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
    const ids = (await f.plans.getLibrary(f.client.id)).active.map((p) => p.id);
    const exported = await f.transfer.exportClient(f.client.id, ids);
    assert.deepEqual(exported.programs[0]!.mesocycles.map((c) => c.title), [cycle.title, "Второй цикл"]);
    assert.deepEqual(exported.sessions.map((s) => String(s.actualDate)).sort(), whole.value.sessions.map((s) => String(s.actualDate)).sort());
    assert.equal(exported.sessions.flatMap((s) => s.notes).length, 4);
    const factualValues = (v: ReturnType<typeof trainingTransferFixture>) => v.sessions.flatMap((s) => s.facts.map((f) => JSON.stringify([s.weekIndex, f.values]))).sort();
    assert.deepEqual(factualValues(exported), factualValues(whole.value));
    const plannedValues = (v: ReturnType<typeof trainingTransferFixture>) => v.programs.flatMap((p) => p.mesocycles.flatMap((c) => c.weeks.flatMap((w) => w.workouts.flatMap((item) => item.exercises.flatMap((e) => e.sets.map((s) => [s.reps, s.repsMax, s.loadGrams, s.durationSec, s.distanceM]))))));
    assert.deepEqual(plannedValues(exported), plannedValues(whole.value));
    // Previously saved partial imports belong to a different import namespace and remain independent.
    await f.transfer.importClient(f.client.id, base, f.mapping);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 2);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_performed_sets").get()!.n, 6);
    // Тот же импорт ещё раз создаёт новую программу (решение владельца 2026-10-27): 4 результата книги сверх прежних 6.
    await f.transfer.importClient(f.client.id, whole.value, whole.mapping, { rememberMatches: matches });
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 3);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_performed_sets").get()!.n, 10);
  } finally { await f.close(); }
});

test("export reads results in a bounded number of queries however many sessions exist (CA-15)", async () => {
  const manyWeeks = (count: number) => {
    const base = trainingTransferFixture(); const cycle = base.programs[0]!.mesocycles[0]!; const first = cycle.weeks[0]!; const session = base.sessions[0]!;
    const weeks = Array.from({ length: count }, (_, at) => { const n = at + 1; return { ...first, id: `week${n}`, index: n, workouts: first.workouts.map((w) => ({ ...w, id: `w${n}`,
      exercises: w.exercises.map((e) => ({ ...e, id: `e${n}`, sets: e.sets.map((s, k) => ({ ...s, id: `s${n}-${k}` })) })) })) }; });
    const sessions = weeks.map((w) => { const workout = w.workouts[0]!; const exercise = workout.exercises[0]!;
      return { ...session, id: `session${w.index}`, weekIndex: w.index, plannedWorkoutId: workout.id, notes: [{ plannedExerciseId: exercise.id, text: "Без боли" }],
        facts: [{ ...session.facts[0]!, id: `fact${w.index}`, plannedSetId: exercise.sets[0]!.id, plannedExerciseId: exercise.id }] }; });
    return { ...base, programs: [{ ...base.programs[0]!, mesocycles: [{ ...cycle, weeks }] }], sessions };
  };
  const statementsToExport = async (weeks: number) => {
    const f = await fixture();
    try {
      await f.transfer.importClient(f.client.id, manyWeeks(weeks), f.mapping);
      const ids = (await f.plans.getLibrary(f.client.id)).active.map((p) => p.id);
      let count = 0; const db = f.native as unknown as { prepare: (sql: string) => unknown }; const original = db.prepare.bind(f.native);
      db.prepare = (sql: string) => { count += 1; return original(sql); };
      const exported = await f.transfer.exportClient(f.client.id, ids);
      db.prepare = original;
      assert.equal(exported.sessions.length, weeks);
      return count;
    } finally { await f.close(); }
  };
  const few = await statementsToExport(3); const many = await statementsToExport(30);
  assert.equal(many, few, `3 sessions: ${few} queries, 30 sessions: ${many} queries`);
});
test("I07 a book can be imported again after its programme was deleted with results, and a leftover receipt never blocks it", async () => {
  const f = await fixture();
  try {
    const base = trainingTransferFixture();
    let session = prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value: base }, false), []);
    session = setWorkbookNameMatch(session, base.exercises[0]!.name, f.mapping.press!);
    const whole = compileWholeWorkbook(session); const matches = workbookMatchesToRemember(session, true);
    await f.transfer.importClient(f.client.id, whole.value, whole.mapping, { rememberMatches: matches });
    const programId = (await f.plans.getLibrary(f.client.id)).active[0]!.id; const revision = (await f.plans.getProgram(f.client.id, programId))!.revision;
    const lease = await f.database.acquire();
    try {
      await lease.writer.write(async (tx) => {
        await f.execution.cleanupParticipant.remove(tx, f.client.id, programId, null);
        await f.plans.deleteParticipant.deleteProgram(tx, { clientId: f.client.id, programId, expectedRevision: revision }, new Date());
      });
    } finally { await f.database.release(); }
    for (const table of ["training_programs", "training_sessions", "training_performed_sets"]) assert.equal(f.native.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0, `${table} after delete`);
    await f.transfer.importClient(f.client.id, whole.value, whole.mapping, { rememberMatches: matches });
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 1);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_performed_sets").get()!.n, 2, "the results come back with the book");
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("I07 a workbook saved as a new programme can be saved again after that programme was deleted with results", async () => {
  const f = await fixture();
  try {
    const imported = builderWorkbookImport(selectWorkbookImportSheets(multiBook(f.mapping.press!), ["0"]));
    const request: BuilderWorkbookSaveRequest = { clientId: f.client.id, scope: { programId: null, mesocycleId: null }, expectedRevision: null,
      programTitle: "Книга", cycles: imported.cycles!, clientIds: [f.client.id], existingCycleKey: null, placements: [] };
    const first = await f.transfer.saveBuilderWorkbook(request);
    const revision = (await f.plans.getProgram(f.client.id, first.programId))!.revision; const lease = await f.database.acquire();
    try {
      await lease.writer.write(async (tx) => {
        await f.execution.cleanupParticipant.remove(tx, f.client.id, first.programId, null);
        await f.plans.deleteParticipant.deleteProgram(tx, { clientId: f.client.id, programId: first.programId, expectedRevision: revision }, new Date());
      });
    } finally { await f.database.release(); }
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 0);
    const again = await f.transfer.saveBuilderWorkbook(request);
    assert.ok(again.programId.length > 0);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 1);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_performed_sets").get()!.n, 2);
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("I06 imported workouts are completed by their records, a week without records stays not started; rename preserves plans and facts", async () => {
  const f = await fixture();
  try {
    const base = trainingTransferFixture(); const cycle = base.programs[0]!.mesocycles[0]!; const first = cycle.weeks[0]!; const w1 = first.workouts[0]!;
    // Неделя 1 получает вторую тренировку без записей: неделя с результатами, значит она завершена; неделя 3 пуста целиком.
    const second = { ...w1, id: "w1-second", title: "Тренировка 2", exercises: w1.exercises.map((e) => ({ ...e, id: `x-${e.id}`, sets: e.sets.map((s) => ({ ...s, id: `x-${s.id}` })) })) };
    const weeks = cycle.weeks.map((w, at) => (at === 0 ? { ...first, workouts: [w1, second] } : w));
    const input = { ...base, programs: [{ ...base.programs[0]!, mesocycles: [{ ...cycle, weeks }] }], sessions: base.sessions.map((s) => ({ ...s, actualDate: null })) };
    const session = prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value: input }, false), [{ id: f.mapping.press!, name: base.exercises[0]!.name, available: true }]);
    const whole = compileWholeWorkbook(session);
    assert.equal(whole.value.sessions.length, 3, "two with results and one empty workout of a week with results; none for the empty week 3");
    assert.ok(whole.value.sessions.every((s) => s.outcome === "COMPLETED" && s.actualDate === null));
    await f.transfer.importClient(f.client.id, whole.value, whole.mapping);
    const program = (await f.plans.getLibrary(f.client.id)).active[0]!;
    const statuses = await f.execution.getProgramStatuses(f.client.id, program.id);
    assert.equal(statuses.length, 3); assert.ok(statuses.every((s) => s.status === "COMPLETED"));
    const planWeeks = (await f.plans.getPeriodizedPlan(f.client.id, program.id))!.mesocycles[0]!.weeks;
    const statusOf = (week: number, workoutId: string) => statuses.find((s) => s.weekIndex === week && s.plannedWorkoutId === workoutId)?.status ?? "NOT_STARTED";
    assert.deepEqual(planWeeks.map((w) => weekStatus(w.workouts.map((x) => statusOf(w.index, x.id)))), ["COMPLETED", "COMPLETED", "NOT_STARTED"]);
    assert.deepEqual(await f.execution.listActiveWorkouts(), []);
    const weeks2 = planWeeks;
    const previousWorkout = weeks2[0]!.workouts[0]!; const currentWorkout = weeks2[1]!.workouts[0]!;
    const previous = await f.execution.getPrevious({ clientId: f.client.id, programId: program.id, weekIndex: 2, plannedWorkoutId: currentWorkout.id }, previousWeekQueries(currentWorkout, previousWorkout));
    assert.equal(previous.get(currentWorkout.exercises[0]!.sets[0]!.id)?.values.reps, 8);
    assert.equal(previous.get(currentWorkout.exercises[0]!.sets[0]!.id)?.date, null);
    const rows = () => ["training_mesocycles", "training_workouts", "training_planned_sets", "training_sessions", "training_performed_sets"].map((table) => f.native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = rows();
    await f.plans.renameProgram(program.id, program.revision, "Новое имя программы");
    assert.deepEqual(rows(), before);
    assert.equal((await f.plans.getLibrary(f.client.id)).active[0]!.title, "Новое имя программы");
    const exported = await f.transfer.exportClient(f.client.id, [program.id]);
    assert.equal(exported.sessions.length, 3);
    assert.equal(exported.sessions.flatMap((s) => s.facts).length, 2);
    assert.ok(exported.sessions.every((s) => s.outcome === "COMPLETED" && s.actualDate === null && s.startedAt === null && s.finishedAt === null));
    assert.deepEqual(readTrainingWorkbook(readWorkbook(writeTrainingWorkbook(exported))).sessions, exported.sessions);
  } finally { await f.close(); }
});

test("an outcome written in a 3.0 file survives the import: missed stays missed, the rule decides only where there is none", async () => {
  const f = await fixture();
  try {
    const base = trainingTransferFixture();
    const input = { ...base, sessions: base.sessions.map((s) => (s.weekIndex === 2 ? { ...s, outcome: "MISSED" as const } : s)) };
    const session = prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value: input }, false), [{ id: f.mapping.press!, name: base.exercises[0]!.name, available: true }]);
    const whole = compileWholeWorkbook(session);
    await f.transfer.importClient(f.client.id, whole.value, whole.mapping);
    const program = (await f.plans.getLibrary(f.client.id)).active[0]!;
    const statuses = await f.execution.getProgramStatuses(f.client.id, program.id);
    assert.deepEqual(statuses.map((s) => [s.weekIndex, s.status]).sort(), [[1, "COMPLETED"], [2, "MISSED"]]);
  } finally { await f.close(); }
});

test("I06 upgrading populated execution v2 preserves every row and guard and rolls back on failure", async () => {
  const f = await fixture(); const native = new DatabaseSync(":memory:"); const port = nodeSqlitePort(native);
  try {
    const value = trainingTransferFixture();
    await f.transfer.importClient(f.client.id, { ...value, sessions: value.sessions.map((s) => ({ ...s, facts: s.facts.map((fact) => ({ ...fact, setType: "DROP" as const, drops: [fact.values], sides: { left: { values: fact.values, confirmed: true }, right: { values: fact.values, confirmed: false } } })) })) }, f.mapping);
    await port.exclusive(async (tx) => {
      for (const owner of SCHEMA_OWNERS) await runMigrationsInTransaction(tx, owner.owner === "training_execution" ? owner.chain.slice(0, 2) : owner.chain, owner.ledger);
    });
    const tables = ["workspaces", "clients", "training_sessions", "training_performed_sets", "training_performed_drops", "training_performed_sides", "training_exercise_notes"];
    // Исходная база уже на последней версии: переносятся только колонки, которые есть в базе v2 (миграция v4 добавила calendar_appointment_id).
    for (const table of tables) for (const row of f.native.prepare(`SELECT * FROM ${table}`).all()) {
      const present = new Set((native.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name));
      const keys = Object.keys(row).filter((key) => present.has(key)); native.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...keys.map((key) => row[key] as never));
    }
    // Колонка, добавленная миграцией v4, в сравнение строк не входит: у перенесённых строк она пуста.
    const snapshot = () => tables.map((table) => native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all().map(({ calendar_appointment_id: added, ...row }) => { void added; return row; }));
    const before = snapshot();
    const objects = () => native.prepare("SELECT type,name,sql FROM sqlite_master WHERE type IN ('trigger','index') AND sql IS NOT NULL ORDER BY name").all();
    const guards = objects();
    const failing = devTrainingExecutionCatalog.map((s) => s.version === 3 ? { ...s, statements: [...s.statements, "INSERT INTO i06_no_table VALUES(1)"] } : s);
    await assert.rejects(port.exclusive((tx) => runMigrationsInTransaction(tx, failing, DEV_TRAINING_EXECUTION_LEDGER)));
    assert.deepEqual(snapshot(), before); assert.deepEqual(objects(), guards);
    assert.equal(native.prepare("PRAGMA table_info(training_sessions)").all().find((c) => c.name === "actual_date")!.notnull, 1);
    await port.exclusive((tx) => runMigrationsInTransaction(tx, devTrainingExecutionCatalog, DEV_TRAINING_EXECUTION_LEDGER));
    assert.deepEqual(snapshot(), before); assert.deepEqual(objects(), guards);
    assert.equal(native.prepare("PRAGMA table_info(training_sessions)").all().find((c) => c.name === "actual_date")!.notnull, 0);
    assert.deepEqual(native.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(native.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
    assert.equal(native.prepare("SELECT count(*) AS n FROM sqlite_temp_master").get()!.n, 0);
    await port.exclusive((tx) => runMigrationsInTransaction(tx, devTrainingExecutionCatalog, DEV_TRAINING_EXECUTION_LEDGER));
    assert.deepEqual(snapshot(), before);
  } finally { native.close(); await f.close(); }
});

async function fixture() {
  const native = new DatabaseSync(":memory:"); const database = new SharedSqliteDatabase(async () => nodeSqlitePort(native));
  await database.acquire(); await prepareProductionDatabase(database);
  const clients = new DevClientRepository(database, "local-trainer", []);
  const plans = new DevTrainingPlansRepository(database, "local-trainer"); const execution = new DevTrainingExecutionRepository(database, "local-trainer");
  const system = { meta: { version: "test", source: "REPDB", license: "test", exerciseCount: 0 }, exercises: [] } as unknown as SystemCatalog;
  const exercises = new DevExerciseCatalogRepository(database, "local-trainer", system);
  await clients.initialize(); await plans.initialize(); await execution.initialize(); await exercises.initialize();
  const client = await clients.create({ displayName: "Тест переноса" }); const exercise = await exercises.createCustom({ name: "Жим штанги лёжа", bodyPart: "chest", trackingProfile: "LOAD_REPS", equipment: "barbell" });
  const transfer = createTrainingTransfer(database, "local-trainer", plans, execution, exercises);
  return { native, database, plans, execution, clients, exercises, client, mapping: { press: exercise.id }, transfer,
    async close() { await clients.close(); await plans.close(); await execution.close(); await exercises.close(); await database.release(); } };
}

test("I02 unresolved factual ranges cannot write; explicit corrections import atomically through owners", async () => {
  const f = await fixture();
  try {
    const table = flattenLegacyMatrix({ name: "Спорные результаты", rows: [["Упражнение", "Подход", "Неделя 1"],
      ["", "", "План", "Пред.", "Повт.", "Кг", "Дата"], ["Тренировка А"],
      ["Жим штанги лёжа", 1, "8–10 × 62,5 кг", "", "8-10", "42,5", "2026-10-20"],
      ["", 2, "8–10 × 62,5 кг", "", "8-10", "", "2026-10-20"]] })!;
    const found = detectLegacyMapping(table);
    const input = normalizeLegacyTable(table, "i02-owner-fixture", found.header, found.mapping);
    const mapping = Object.fromEntries(input.exercises.map((exercise) => [exercise.id, f.mapping.press]));
    await assert.rejects(f.transfer.importClient(f.client.id, input, mapping), /проверить/);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 0);
    let corrected = correctTransferIssue(input, input.issues![0]!.id, "10");
    corrected = correctTransferIssue(corrected, corrected.issues![0]!.id, "пусто");
    await f.transfer.importClient(f.client.id, corrected, mapping);
    const facts = f.native.prepare("SELECT reps, load_grams, confirmed_at FROM training_performed_sets ORDER BY position").all();
    assert.equal(facts.length, 2);
    assert.equal(facts[0]!.reps, 10); assert.equal(facts[0]!.load_grams, 42500);
    assert.equal(facts[1]!.reps, null); assert.equal(facts[1]!.load_grams, null); assert.equal(facts[1]!.confirmed_at, null);
    await f.transfer.importClient(f.client.id, corrected, mapping); // повтор создаёт новую программу
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_performed_sets").get()!.n, 4);
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("2.0 visible-only workbook imports through 3.0 owners with plans and facts", async () => {
  const require = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
  const XLSX = require("xlsx") as typeof import("../apps/mobile/node_modules/xlsx/types/index.d.ts");
  const book = readWorkbook(new Uint8Array(readFileSync(new URL("./fixtures/v2-visible-training-matrix.xlsx", import.meta.url))));
  const name = book.SheetNames[0]!; const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[name]!, { header: 1, defval: "", raw: false });
  const table = flattenLegacyMatrix({ name, rows })!; const found = detectLegacyMapping(table); const value = normalizeLegacyTable(table, "visible-v2-fixture", found.header, found.mapping);
  const f = await fixture();
  try {
    const mapping = Object.fromEntries(value.exercises.map((e) => [e.id, f.mapping.press]));
    await f.transfer.importClient(f.client.id, value, mapping);
    assert.equal(f.native.prepare("SELECT count(*) n FROM training_planned_sets").get()?.n, 2);
    assert.equal(f.native.prepare("SELECT count(*) n FROM training_performed_sets").get()?.n, 2);
    assert.equal(f.native.prepare("SELECT load_grams FROM training_performed_sets LIMIT 1").get()?.load_grams, 62500);
    assert.equal(f.native.prepare("SELECT actual_date FROM training_sessions LIMIT 1").get()?.actual_date, "2026-10-20");
  } finally { await f.close(); }
});

test("I04 remembered source names are exact, workspace scoped and persist when services are recreated", async () => {
  const f = await fixture();
  try {
    const second = await f.exercises.createCustom({ name: "Другая тяга", bodyPart: "back", equipment: "cable", trackingProfile: "LOAD_REPS" });
    await f.transfer.rememberExerciseMatches([{ sourceName: "Тяга", targetId: f.mapping.press! }, { sourceName: "тяга", targetId: second.id }]);
    const next = createTrainingTransfer(f.database, "local-trainer", f.plans, f.execution, f.exercises);
    assert.deepEqual(await next.getExerciseMatches(["Тяга", "тяга", "ТЯГА"]), [
      { sourceName: "Тяга", targetId: f.mapping.press, available: true }, { sourceName: "тяга", targetId: second.id, available: true }]);
    assert.deepEqual(await new ExerciseImportMatchStore("other-workspace").read(nodeSqlitePort(f.native), ["Тяга"]), []);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 0);
  } finally { await f.close(); }
});

test("I04 unavailable remembered targets are reported for a fresh choice and cannot be silently imported", async () => {
  const f = await fixture();
  try {
    const match = { sourceName: "Жим", targetId: f.mapping.press! };
    await f.transfer.rememberExerciseMatches([match]);
    await f.exercises.setHidden(match.targetId, true);
    assert.deepEqual(await f.transfer.getExerciseMatches(["Жим"]), [{ ...match, available: false }]);
    await assert.rejects(f.transfer.importClient(f.client.id, trainingTransferFixture(), f.mapping), /скрыто/);
    await assert.rejects(f.transfer.rememberExerciseMatches([match]), /скрыто/);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_programs").get()!.n, 0);
    await f.exercises.setHidden(match.targetId, false);
    await f.exercises.archiveCustom(match.targetId);
    assert.deepEqual(await f.transfer.getExerciseMatches(["Жим"]), [{ ...match, available: false }]);
    f.native.prepare("UPDATE training_import_exercise_matches SET target_id = 'missing-target'").run();
    assert.equal((await f.transfer.getExerciseMatches(["Жим"]))[0]!.available, false);
  } finally { await f.close(); }
});

test("I04 import and new remembered matches commit atomically and never edit previous cycles or results", async () => {
  const f = await fixture();
  try {
    const input = trainingTransferFixture();
    const match = { sourceName: input.exercises[0]!.name, targetId: f.mapping.press! };
    f.native.exec("CREATE TRIGGER qa_fail_remember BEFORE INSERT ON training_import_exercise_matches BEGIN SELECT RAISE(ABORT, 'QA_REMEMBER_FAILURE'); END");
    await assert.rejects(f.transfer.importClient(f.client.id, input, f.mapping, { rememberMatches: [match] }), /QA_REMEMBER_FAILURE/);
    for (const table of ["training_programs", "training_sessions", "training_performed_sets", "training_transfer_receipts", "training_import_exercise_matches"]) {
      assert.equal(f.native.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n, 0);
    }
    f.native.exec("DROP TRIGGER qa_fail_remember");
    await f.transfer.importClient(f.client.id, input, f.mapping, { rememberMatches: [match] });
    const tables = ["training_programs", "training_mesocycles", "training_workouts", "training_planned_exercises", "training_planned_sets", "training_sessions", "training_performed_sets"];
    const protectedRows = () => tables.map((table) => f.native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = protectedRows();
    const second = await f.exercises.createCustom({ name: "Новый вариант жима", bodyPart: "chest", equipment: "dumbbell", trackingProfile: "LOAD_REPS" });
    await f.transfer.rememberExerciseMatches([{ ...match, targetId: second.id }]);
    assert.deepEqual(protectedRows(), before);
    assert.deepEqual(await f.transfer.getExerciseMatches([match.sourceName]), [{ ...match, targetId: second.id, available: true }]);
    await assert.rejects(f.transfer.importClient(f.client.id, input, f.mapping, { rememberMatches: [{ sourceName: "Не из этой книги", targetId: second.id }] }), /открытому листу/);
    assert.deepEqual(protectedRows(), before);
  } finally { await f.close(); }
});

test("I04 alias migration only adds storage; failed migration rolls back DDL and the ledger", async () => {
  const f = await fixture();
  try {
    await f.transfer.importClient(f.client.id, trainingTransferFixture(), f.mapping);
    f.native.exec("DROP TABLE training_import_exercise_matches; DELETE FROM training_transfer_schema_migrations WHERE version >= 2");
    const tables = f.native.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => String(row.name));
    const protectedRows = () => tables.map((table) => f.native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
    const before = protectedRows();
    const aliasChain = TRANSFER_OWNER.chain.slice(0, 2);
    const failing = aliasChain.map((step) => step.version === 2 ? { ...step, statements: [...step.statements, "INSERT INTO qa_missing_table VALUES (1)"] } : step);
    await assert.rejects(nodeSqlitePort(f.native).exclusive((tx) => runMigrationsInTransaction(tx, failing, TRANSFER_OWNER.ledger)));
    assert.deepEqual(protectedRows(), before);
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='training_import_exercise_matches'").get()!.n, 0);
    await nodeSqlitePort(f.native).exclusive((tx) => runMigrationsInTransaction(tx, aliasChain, TRANSFER_OWNER.ledger));
    assert.deepEqual(tables.filter((table) => table !== TRANSFER_OWNER.ledger).map((table) => f.native.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()),
      tables.map((table, index) => ({ table, rows: before[index] })).filter(({ table }) => table !== TRANSFER_OWNER.ledger).map(({ rows }) => rows));
    assert.equal(f.native.prepare("SELECT count(*) AS n FROM training_import_exercise_matches").get()!.n, 0);
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("transactional Excel import persists actual owner data, computes previous results and a repeat adds a new programme", async () => {
  const f = await fixture();
  try {
    const input = trainingTransferFixture(); await f.transfer.importClient(f.client.id, input, f.mapping);
    const p = (await f.plans.getLibrary(f.client.id)).active[0]!;
    const plan = (await f.plans.getPeriodizedPlan(f.client.id, p.id))!;
    assert.equal(plan.mesocycles[0]?.weeks[0]?.workouts[0]?.exercises[0]?.sets[0]?.loadGrams, 62500);
    const weeks = plan.mesocycles[0]!.weeks; const first = weeks[0]!.workouts[0]!; const w = weeks[1]!.workouts[0]!; const e = w.exercises[0]!;
    const slot = { clientId: f.client.id, programId: p.id, weekIndex: 2, plannedWorkoutId: w.id };
    const previous = await f.execution.getPrevious(slot, [{ plannedExerciseId: e.id, exerciseId: e.exerciseId, plannedSetIds: e.sets.map((s) => s.id),
      source: { plannedWorkoutId: first.id, plannedExerciseId: first.exercises[0]!.id } }]);
    assert.equal(previous.get(e.sets[0]!.id)?.values.reps, 8);
    const exported = await f.transfer.exportClient(f.client.id, [p.id]);
    assert.equal(exported.sessions.length, 2); assert.equal(exported.sessions[0]?.facts[0]?.values.loadGrams, 62500);
    await f.transfer.importClient(f.client.id, input, f.mapping);
    assert.equal((await f.plans.getLibrary(f.client.id)).active.length, 2, "a repeat is a new programme (owner decision 2026-10-27)");
    assert.equal(f.native.prepare("SELECT count(*) n FROM training_performed_sets").get()?.n, 4);
  } finally { await f.close(); }
});
test("the new engine keeps no receipts: every import is a new programme with fresh ids", async () => {
  const f = await fixture();
  try {
    const input = trainingTransferFixture();
    await f.transfer.importClient(f.client.id, input, f.mapping); await f.transfer.importClient(f.client.id, input, f.mapping);
    const programs = (await f.plans.getLibrary(f.client.id)).active.map((p) => p.id);
    assert.equal(programs.length, 2); assert.notEqual(programs[0], programs[1]);
    assert.ok(programs.every((id) => id !== "program"), "source ids are never reused");
    assert.equal(f.native.prepare("SELECT count(*) n FROM training_transfer_receipts").get()?.n, 0);
    assert.equal(f.native.prepare("SELECT count(*) n FROM training_sessions").get()?.n, 4);
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});
test("an inconsistent transfer is refused before anything is written, naming the problem", async () => {
  const f = await fixture();
  try {
    const input = trainingTransferFixture(); const cycle = input.programs[0]!.mesocycles[0]!; const workout = cycle.weeks[0]!.workouts[0]!;
    const broken = { ...input, programs: [{ ...input.programs[0]!, mesocycles: [{ ...cycle, weeks: [{ ...cycle.weeks[0]!, workouts: [workout, workout] }, ...cycle.weeks.slice(1)] }] }] };
    await assert.rejects(f.transfer.importClient(f.client.id, broken, f.mapping), /Повтор идентификатора тренировки/u);
    for (const table of ["training_programs", "training_sessions", "training_performed_sets"]) assert.equal(f.native.prepare(`SELECT count(*) n FROM ${table}`).get()?.n, 0, table);
  } finally { await f.close(); }
});
test("unresolved source values block import before any plans, sessions or receipts are written", async () => {
  const f = await fixture();
  try {
    const value = trainingTransferFixture(); const session = value.sessions[0]!; const fact = session.facts[0]!;
    const input = { ...value, issues: [{ id: "pending-source", programId: session.programId, scope: "FACT" as const, targetId: fact.id, field: "reps" as const, raw: "10-15" }] };
    await assert.rejects(f.transfer.importClient(f.client.id, input, f.mapping), /Нужно проверить/u);
    for (const table of ["training_programs", "training_sessions", "training_transfer_receipts"]) assert.equal(f.native.prepare(`SELECT count(*) n FROM ${table}`).get()?.n, 0);
  } finally { await f.close(); }
});
test("a late invalid fact rolls back plans, sessions and receipts together", async () => {
  const f = await fixture();
  try {
    f.native.exec("CREATE TRIGGER fail_transfer BEFORE INSERT ON training_performed_sets WHEN NEW.reps=10 BEGIN SELECT RAISE(ABORT,'SYNTHETIC_TRANSFER_FAILURE'); END");
    await assert.rejects(f.transfer.importClient(f.client.id, trainingTransferFixture(), f.mapping), /SYNTHETIC_TRANSFER_FAILURE/u);
    assert.equal((await f.plans.getLibrary(f.client.id)).active.length, 0);
    assert.equal(f.native.prepare("SELECT count(*) n FROM training_transfer_receipts").get()?.n, 0);
    assert.equal(f.native.prepare("SELECT count(*) n FROM training_sessions").get()?.n, 0);
  } finally { await f.close(); }
});
test("3.0 Excel round trip to a clean database preserves every planned and actual value", async () => {
  const source = await fixture(); const target = await fixture();
  try {
    const input = trainingTransferFixture(); await source.transfer.importClient(source.client.id, input, source.mapping);
    const programs = (await source.plans.getLibrary(source.client.id)).active.map((p) => p.id);
    const exported = await source.transfer.exportClient(source.client.id, programs);
    const parsed = readTrainingWorkbook(readWorkbook(writeTrainingWorkbook(exported)));
    const mapping = Object.fromEntries(parsed.exercises.map((e) => [e.id, target.mapping.press]));
    await target.transfer.importClient(target.client.id, parsed, mapping);
    const actual = await target.transfer.exportClient(target.client.id, (await target.plans.getLibrary(target.client.id)).active.map((p) => p.id));
    const expected = sameIds(parsed, target.client.id, mapping);
    assert.deepEqual(anonymizeIds(actual.programs), anonymizeIds(expected.programs));
    assert.deepEqual(anonymizeIds({ sessions: bySlot(actual.sessions), programs: actual.programs }).sessions, anonymizeIds({ sessions: bySlot(expected.sessions), programs: expected.programs }).sessions);
  } finally { await source.close(); await target.close(); }
});
test("2.0's generated matrix imports into clean 3.0 and reconstructs plans and previous results", async () => {
  const f = await fixture();
  try {
    const bytes = readFileSync(new URL("./fixtures/v2-training-matrix.xlsx", import.meta.url));
    const input = readTrainingWorkbook(readWorkbook(bytes)); const mapping = Object.fromEntries(input.exercises.map((e) => [e.id, f.mapping.press]));
    await f.transfer.importClient(f.client.id, input, mapping);
    const actual = await f.transfer.exportClient(f.client.id, (await f.plans.getLibrary(f.client.id)).active.map((p) => p.id));
    assert.deepEqual(anonymizeIds(actual.programs), anonymizeIds(sameIds(input, f.client.id, mapping).programs));
    assert.equal(actual.sessions.length, 2); assert.equal(actual.sessions[0]?.facts[0]?.values.loadGrams, 62500);
    assert.equal(actual.programs[0]?.mesocycles[0]?.weeks[0]?.workouts[0]?.exercises[0]?.sets[0]?.repsMax, 10);
    const p = actual.programs[0]!; const first = p.mesocycles[0]!.weeks[0]!.workouts[0]!; const second = p.mesocycles[0]!.weeks[1]!.workouts[0]!;
    assert.equal(first.exercises[0]?.lineageId, second.exercises[0]?.lineageId);
    const previous = await f.execution.getPrevious({ clientId: f.client.id, programId: p.id, weekIndex: 2, plannedWorkoutId: second.id }, previousWeekQueries(second, first));
    assert.equal(previous.get(second.exercises[0]!.sets[0]!.id)?.values.loadGrams, 62500);
  } finally { await f.close(); }
});
test("native 3.0 backup keeps an Excel-imported programme with its results and the remembered exercise matches", async () => {
  const f = await fixture(); const dir = mkdtempSync(join(tmpdir(), "transfer-backup-"));
  try {
    const base = trainingTransferFixture();
    const whole = compileWholeWorkbook(prepareWholeWorkbook(startWorkbookReview({ kind: "TRANSFER", value: base }, false),
      [{ id: f.mapping.press!, name: base.exercises[0]!.name, available: true }]));
    await f.transfer.importClient(f.client.id, whole.value, whole.mapping);
    await f.transfer.rememberExerciseMatches([{ sourceName: "Название в исходном Excel", targetId: f.mapping.press! }]);
    const destination = join(dir, "copy.atbackup"); const staging = join(dir, "stage.db");
    await createSqliteBackup(f.native, join(dir, "partial.db"), destination, { backupId: randomUUID(), createdAt: new Date().toISOString() });
    await prepareBackupForRestore(destination, staging);
    const restored = new DatabaseSync(staging);
    try {
      assert.equal(restored.prepare("SELECT count(*) n FROM training_programs").get()?.n, 1);
      assert.equal(restored.prepare("SELECT count(*) n FROM training_performed_sets").get()?.n, 2);
      assert.deepEqual(restored.prepare("SELECT source_name, target_id FROM training_import_exercise_matches").all(),
        f.native.prepare("SELECT source_name, target_id FROM training_import_exercise_matches").all());
      assert.equal(restored.prepare("SELECT count(*) n FROM training_sessions").get()?.n, 2);
      assert.equal(restored.prepare("SELECT count(*) n FROM training_sessions WHERE outcome='COMPLETED'").get()?.n, 2);
      assert.equal(restored.prepare("SELECT count(*) n FROM training_sessions WHERE actual_date IS NULL").get()?.n, 0);
      assert.equal(restored.prepare("SELECT load_grams FROM training_planned_sets WHERE load_grams IS NOT NULL LIMIT 1").get()?.load_grams, 62500);
    } finally { restored.close(); }
  } finally { await f.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("old-format history stays in storage but is excluded from the current matrix export", async () => {
  const f = await fixture();
  try {
    const base = trainingTransferFixture(); const history = { id: "version", programId: "program", validFrom: "2026-09-01T00:00:00.000Z", validTo: "2026-10-01T00:00:00.000Z", simple: null, mesocycle: { ...base.programs[0]!.mesocycles[0]!, title: "Прежняя структура" } };
    const value = { ...base, planHistory: [history] }; await f.transfer.importClient(f.client.id, value, f.mapping);
    const actual = await f.transfer.exportClient(f.client.id, (await f.plans.getLibrary(f.client.id)).active.map((p) => p.id));
    assert.deepEqual(actual.planHistory, []);
    assert.equal(f.native.prepare("SELECT count(*) n FROM training_structure_versions").get()?.n, 1);
  } finally { await f.close(); }
});
test("results of a deleted plan stay in storage and do not create phantom matrix rows", async () => {
  const f = await fixture();
  try {
    const input = sameIds(trainingTransferFixture(), f.client.id, f.mapping);
    const lease = await f.database.acquire();
    try { await lease.writer.write((tx) => importTrainingExecutions(tx, "local-trainer", f.client.id, input.sessions.map((s) => ({ ...s, origin: { programTitle: "Удалённый план", programKind: "PERIODIZED", mesocycleTitle: "Цикл", workoutTitle: "Тренировка 1" } })))); }
    finally { await f.database.release(); }
    const exported = await f.transfer.exportClient(f.client.id, [input.programs[0]!.id]);
    assert.equal(exported.programs.length, 0); assert.equal(exported.sessions.length, 0);
    assert.equal(f.native.prepare("SELECT count(*) n FROM training_sessions").get()?.n, 2);
  } finally { await f.close(); }
});

/** Импортированный цикл, правленый в конструкторе до первого сохранения. */
async function importedCycleEdit(edit: "REPLACE_EXERCISE" | "REMOVE_WORKOUT") {
  const f = await fixture();
  const first = builderWorkbookImport(selectWorkbookImportSheets(multiBook(f.mapping.press!), ["0"])); const cycle0 = first.cycles![0]!;
  const edited = { ...cycle0, weeks: cycle0.weeks.map((w, at) => ({ ...w, workouts: at !== 0 ? w.workouts : edit === "REMOVE_WORKOUT" ? []
    : w.workouts.map((x) => ({ ...x, exercises: x.exercises.map((e) => ({ ...e, id: `${e.id}-replaced`, sets: e.sets.map((s) => ({ ...s, id: `${s.id}-replaced` })) })) })) })) };
  const request: BuilderWorkbookSaveRequest = { clientId: f.client.id, scope: { programId: null, mesocycleId: null }, expectedRevision: null,
    programTitle: "Правка до сохранения", cycles: [edited], clientIds: [f.client.id], existingCycleKey: null, placements: [] };
  const count = (table: string) => f.native.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n as number;
  return { f, request, count };
}
async function plannedAndStatuses(f: Awaited<ReturnType<typeof fixture>>, programId: string) {
  const planned = new Set((await f.plans.getPeriodizedPlan(f.client.id, programId))!.mesocycles.flatMap((c) => c.weeks.flatMap((w) => w.workouts.map((x) => x.id))));
  return { planned, statuses: await f.execution.getProgramStatuses(f.client.id, programId) };
}

test("I07 replacing an exercise of an imported cycle before its first save keeps every imported result", async () => {
  const { f, request, count } = await importedCycleEdit("REPLACE_EXERCISE");
  try {
    const saved = await f.transfer.saveBuilderWorkbook(request); const { planned, statuses } = await plannedAndStatuses(f, saved.programId);
    assert.equal(count("training_performed_sets"), 2, "both imported results of the cycle are stored");
    assert.ok(statuses.every((s) => planned.has(s.plannedWorkoutId)), "every status belongs to a workout of the plan");
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

// CA-22 (решение владельца 2026-10-27, вариант А): как при правке сохранённого цикла — сначала вопрос, затем выбранное действие.
test("I07 removing a workout that has imported results asks first and writes nothing", async () => {
  const { f, request, count } = await importedCycleEdit("REMOVE_WORKOUT");
  try {
    await assert.rejects(f.transfer.saveBuilderWorkbook(request), /WEEK_HAS_RESULTS/);
    for (const table of ["training_programs", "training_sessions", "training_performed_sets", "training_transfer_receipts"]) assert.equal(count(table), 0, table);
  } finally { await f.close(); }
});

test("I07 deleting the results of a removed imported workout keeps the other results and leaves no phantom status", async () => {
  const { f, request, count } = await importedCycleEdit("REMOVE_WORKOUT");
  try {
    const saved = await f.transfer.saveBuilderWorkbook({ ...request, resultsAction: "DELETE" }); const { planned, statuses } = await plannedAndStatuses(f, saved.programId);
    assert.equal(count("training_performed_sets"), 1, "only the result of the removed workout is deleted");
    assert.ok(statuses.length > 0 && statuses.every((s) => planned.has(s.plannedWorkoutId)));
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});

test("I07 keeping the results of a removed imported workout stores them as history of the removed plan", async () => {
  const { f, request, count } = await importedCycleEdit("REMOVE_WORKOUT");
  try {
    const saved = await f.transfer.saveBuilderWorkbook({ ...request, resultsAction: "KEEP_HISTORY" }); const { planned, statuses } = await plannedAndStatuses(f, saved.programId);
    assert.equal(count("training_performed_sets"), 2, "no result is destroyed");
    assert.equal(count("training_sessions WHERE plan_deleted_at IS NOT NULL"), 1, "the removed workout's session is history");
    assert.ok(statuses.every((s) => planned.has(s.plannedWorkoutId)), "history sessions are not statuses of the plan");
    assert.deepEqual(f.native.prepare("PRAGMA foreign_key_check").all(), []);
  } finally { await f.close(); }
});
