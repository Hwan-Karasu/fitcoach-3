import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { DEV_SCHEMA_OWNERS, prepareDevSchema } from "../apps/mobile/src/app/composition/devSchema.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevCalendarRepository } from "../apps/mobile/src/features/calendar/data/DevCalendarRepository.ts";
import { DevAccountingRepository, devAccountingCalendarHook } from "../apps/mobile/src/features/accounting/data/DevAccountingRepository.ts";
import { DevFoodCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevFoodCatalogRepository.ts";
import { DevNutritionDiaryRepository } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { snapshotOfFood } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";
import { DevTrainingPlansRepository } from "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { DevTrainingExecutionRepository } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { addExercise, fillSets, newDraft, setTitle } from "../apps/mobile/src/features/training/plans/domain/SimplePlanEdits.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";
import { runMigrations } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { clearReadIssues, readIssueCount } from "../apps/mobile/src/shared/diagnostics/ReadIssues.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { comparable, readSchema } from "./d01/BaselineSchema.ts";

const A = "synthetic-workspace-a", B = "synthetic-workspace-b";
const NOW = new Date(2026, 9, 22, 12);
const DAY = "2026-10-22";

async function fixture() {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  await shared.acquire();
  const clientsA = new DevClientRepository(shared, A, []), clientsB = new DevClientRepository(shared, B, []);
  await clientsA.initialize(); await clientsB.initialize(); await prepareDevSchema(shared);
  const calendarA = new DevCalendarRepository(shared, A, devAccountingCalendarHook), calendarB = new DevCalendarRepository(shared, B);
  const accounting = new DevAccountingRepository(shared, A);
  const foodsA = new DevFoodCatalogRepository(shared, A), foodsB = new DevFoodCatalogRepository(shared, B);
  const diary = new DevNutritionDiaryRepository(shared, A), plans = new DevTrainingPlansRepository(shared, A);
  const execution = new DevTrainingExecutionRepository(shared, A);
  const stores = [clientsA, clientsB, calendarA, calendarB, accounting, foodsA, foodsB, diary, plans, execution];
  for (const store of stores) await store.initialize();
  const a = await clientsA.create({ displayName: "Synthetic A" }), a2 = await clientsA.create({ displayName: "Synthetic A2" });
  const b = await clientsB.create({ displayName: "Synthetic B" });
  const input = { name: "Synthetic Oats", brand: null, unit: "G" as const, amountX10: 1000, kcalX10: 3600, proteinX10: 125, fatX10: 62, carbsX10: 600 };
  const foodA = await foodsA.create(input, NOW), foodB = await foodsB.create(input, NOW);
  const entry = await diary.addEntry(a.id, { localDate: DAY, slot: "BREAKFAST", snapshot: snapshotOfFood(foodA, 500) }, NOW);
  const draft = fillSets(addExercise(setTitle(newDraft("synthetic-workout"), "Synthetic Plan"), "synthetic-workout", "synthetic-exercise",
    "sys:repdb:synthetic-bench", (i) => `synthetic-set-${i}`), "synthetic-exercise", "reps", 10);
  const program = await plans.createSimpleProgram(a.id, draft, NOW);
  return { db, shared, clientsA, calendarA, calendarB, accounting, foodsA, diary, plans, execution, a, a2, b, foodA, foodB, entry, draft, program,
    close: async () => { for (const store of stores.reverse()) await store.close(); await shared.release(); clearReadIssues(); } };
}

test("D01-3 существующие составные FK отклоняют чужой тип занятия, пакет и участника; владельцев нельзя переписать", async () => {
  const f = await fixture();
  try {
    const typeA = (await f.calendarA.listSessionTypes()).find((type) => !type.requiresCredit)!;
    const typeB = (await f.calendarB.listSessionTypes())[0]!;
    const appointment = await f.calendarA.createAppointment({ localDate: DAY, startMinute: 600, durationMinutes: 60, clientId: f.a.id,
      guestName: null, sessionTypeId: typeA.id, note: null });
    assert.throws(() => f.db.prepare("UPDATE calendar_appointments SET session_type_id = ? WHERE id = ?").run(typeB.id, appointment.id), /FOREIGN KEY/);
    await assert.rejects(f.calendarA.createAppointment({ localDate: DAY, startMinute: 720, durationMinutes: 60, clientId: f.a.id,
      guestName: null, sessionTypeId: typeB.id, note: null }));
    assert.throws(() => f.db.prepare("UPDATE session_types SET workspace_id = ?, seed_key = NULL WHERE id = ?").run(B, typeA.id), /FOREIGN KEY/);
    assert.throws(() => f.db.prepare("UPDATE clients SET workspace_id = ? WHERE id = ?").run(B, f.a.id), /OWNER_SCOPE_IMMUTABLE/);
    assert.throws(() => f.db.prepare("UPDATE training_programs SET workspace_id = ? WHERE id = ?").run(B, f.program.id), /OWNER_SCOPE_IMMUTABLE/);
    assert.throws(() => f.db.prepare("INSERT INTO training_program_members (workspace_id,program_id,client_id,joined_at) VALUES (?, ?, ?, 'x')")
      .run(B, f.program.id, f.b.id), /FOREIGN KEY/);
    assert.equal(f.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { await f.close(); }
});

test("D01-3 учёт: чужой клиент в резерве и чужое рабочее пространство Ledger запрещены; штатная коррекция остаётся атомарной", async () => {
  const f = await fixture();
  try {
    for (const client of [f.a, f.a2]) {
      await f.accounting.setClientMode(client.id, "FITCOACH");
      await f.accounting.createPack(client.id, { title: "Synthetic Pack", creditScope: "GENERAL", sessionTypeId: null, sessionTypeName: null,
        grantedCount: 5, totalKopeks: 50000, expiresOn: null });
    }
    const type = (await f.calendarA.listSessionTypes()).find((item) => item.requiresCredit)!;
    const appointment = await f.calendarA.createAppointment({ localDate: "2026-01-01", startMinute: 600, durationMinutes: 60,
      clientId: f.a.id, guestName: null, sessionTypeId: type.id, note: null });
    const otherPack = (await f.accounting.getClientSnapshot(f.a2.id)).packs[0]!.pack.id;
    assert.throws(() => f.db.prepare("UPDATE credit_reservations SET client_id = ?, pack_id = ? WHERE appointment_id = ?")
      .run(f.a2.id, otherPack, appointment.id), /OWNER_ACCOUNTING_REFERENCE/);
    assert.throws(() => f.db.prepare("UPDATE calendar_appointments SET client_id = ? WHERE id = ?").run(f.a2.id, appointment.id), /OWNER_ACCOUNTING_REFERENCE/);
    const corrected = await f.calendarA.correctClient(appointment.id, appointment.revision, f.a2.id, NOW);
    assert.equal(corrected.clientId, f.a2.id);
    assert.equal((await f.accounting.getClientSnapshot(f.a.id)).available, 5);
    assert.equal((await f.accounting.getClientSnapshot(f.a2.id)).available, 4);
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM credit_reservations").get()?.n, 0);
    const foreignType = (await f.calendarB.listSessionTypes())[0]!.id;
    assert.throws(() => f.db.prepare("UPDATE calendar_appointments SET workspace_id = ?, session_type_id = ? WHERE id = ?")
      .run(B, foreignType, appointment.id), /OWNER_ACCOUNTING_REFERENCE/);
    assert.equal(f.db.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { await f.close(); }
});

test("D01-3 факты: дропы и стороны не могут принадлежать другому workspace; родитель не меняет владельца", async () => {
  const f = await fixture();
  try {
    const saved = await f.execution.saveSet({ slot: { clientId: f.a.id, programId: f.program.id, weekIndex: 1, plannedWorkoutId: "synthetic-workout" },
      plannedExerciseId: "synthetic-exercise", exerciseId: "sys:repdb:synthetic-bench", plannedSetId: "synthetic-set-0", position: 0,
      metrics: ["load", "reps"], expectedRevision: null, setType: "DROP", values: { reps: 8, loadGrams: 50000, durationSec: null, distanceM: null },
      drops: [{ reps: 6, loadGrams: 40000, durationSec: null, distanceM: null }], rpe: null }, NOW);
    const fact = saved.fact;
    assert.throws(() => f.db.prepare("UPDATE training_performed_drops SET workspace_id = ? WHERE set_id = ?").run(B, fact.id), /TRAINING_INTEGRITY_INVALID/);
    assert.throws(() => f.db.prepare("INSERT INTO training_performed_sides (workspace_id,set_id,side,reps,confirmed_at) VALUES (?,?,'L',8,'x')")
      .run(B, fact.id), /TRAINING_INTEGRITY_INVALID/);
    assert.throws(() => f.db.prepare("UPDATE training_performed_sets SET workspace_id = ? WHERE id = ?").run(B, fact.id), /OWNER_SCOPE_IMMUTABLE/);
    assert.equal((await f.execution.getWorkout({ clientId: f.a.id, programId: f.program.id, weekIndex: 1, plannedWorkoutId: "synthetic-workout" })).facts.size, 1);
  } finally { await f.close(); }
});

test("D01-3 дневник: чужой источник отклоняется на INSERT/UPDATE; архив не меняет снимок; использованный источник не удаляется", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.diary.addEntry(f.a.id, { localDate: DAY, slot: "LUNCH", snapshot: snapshotOfFood(f.foodB, 500) }), /OWNER_DIARY_SOURCE/);
    assert.throws(() => f.db.prepare("UPDATE food_diary_entries SET source_id = ? WHERE id = ?").run(f.foodB.id, f.entry.id), /OWNER_DIARY_SOURCE/);
    assert.throws(() => f.db.prepare("UPDATE food_products SET workspace_id = ? WHERE id = ?").run(B, f.foodA.id), /OWNER_SCOPE_IMMUTABLE/);
    assert.throws(() => f.db.prepare("DELETE FROM food_products WHERE id = ?").run(f.foodA.id), /DIARY_SOURCE_IN_USE/);
    f.db.prepare("UPDATE food_products SET archived_at = '2026-10-22', name = 'Synthetic Changed' WHERE id = ?").run(f.foodA.id);
    assert.deepEqual((await f.diary.listEntries(f.a.id, DAY, DAY))[0]!.snapshot, f.entry.snapshot);
    const missing = { ...f.foodA, id: "synthetic-absent-source" };
    const historical = await f.diary.addEntry(f.a.id, { localDate: DAY, slot: "DINNER", snapshot: snapshotOfFood(missing, 300) });
    assert.equal(historical.snapshot.source.id, missing.id, "самодостаточный снимок допускает отсутствующий источник");
    assert.throws(() => f.db.prepare("INSERT INTO food_products SELECT ?, ?, name, brand, basis_unit, basis_amount_x10, kcal_x10, protein_x10, fat_x10, carbs_x10, revision, created_at, updated_at, archived_at, barcode, grams_per_piece_x10, favorite, extra_nutrients_json FROM food_products WHERE id = ?")
      .run(missing.id, B, f.foodA.id), /OWNER_DIARY_SOURCE/);
  } finally { await f.close(); }
});

test("D01-3 JSON: неверная форма и синтаксис не записываются; внешне повреждённый черновик пропускается с сигналом для UI", async () => {
  const f = await fixture();
  try {
    for (const json of ["{", "null", "{}", '"text"', '[null]', '[{"foodId":"x"}]']) {
      assert.throws(() => f.db.prepare("UPDATE food_diary_entries SET ingredients_json = ? WHERE id = ?").run(json, f.entry.id), /NUTRITION_JSON_INVALID/);
    }
    for (const invalid of [{ id: "synthetic-workout" }, { ...f.draft.plan.workouts[0], exercises: [null] },
      { ...f.draft.plan.workouts[0], exercises: [{ id: "x", exerciseId: "sys:x", sets: "bad" }] }]) {
      assert.throws(() => f.db.prepare("INSERT INTO training_simple_overrides VALUES (?, ?, ?, 2, ?, ?)")
        .run(A, f.a.id, f.program.id, "synthetic-workout", JSON.stringify(invalid)), /TRAINING_JSON_INVALID/);
    }
    await f.plans.saveBuilderDraft(f.a.id, f.program.id, f.program.revision, f.draft);
    f.db.exec("DROP TRIGGER training_builder_drafts_json_shape_update");
    f.db.prepare("UPDATE training_builder_drafts SET draft_json = 'null'").run();
    clearReadIssues();
    assert.equal(await f.plans.getBuilderDraft(f.a.id, f.program.id), null);
    assert.equal(readIssueCount(), 1);
    assert.ok(await f.plans.getSimplePlan(f.a.id, f.program.id), "действующий план остаётся читаемым");
    assert.equal(f.db.prepare("SELECT draft_json FROM training_builder_drafts").get()?.draft_json, "null", "чтение ничего не удаляет");
  } finally { await f.close(); }
});

test("D01-3 миграции: baseline→v2 совпадает со свежей установкой; отказ на повреждённой строке сохраняет данные и журнал", async () => {
  const old = new DatabaseSync(":memory:"), fresh = new DatabaseSync(":memory:");
  const writer = new WriterCoordinator(nodeSqlitePort(old)), freshWriter = new WriterCoordinator(nodeSqlitePort(fresh));
  try {
    for (const owner of DEV_SCHEMA_OWNERS) {
      await runMigrations(writer, owner.chain.slice(0, 1), owner.ledger);
      await runMigrations(freshWriter, owner.chain, owner.ledger);
    }
    old.exec("INSERT INTO workspaces VALUES ('w','Synthetic','x'); INSERT INTO clients (id,workspace_id,display_name,lifecycle,revision,created_at,updated_at) VALUES ('c','w','Synthetic','ACTIVE',1,'x','x')");
    old.prepare("INSERT INTO nutrition_batch_commands (workspace_id,client_id,command_id,payload_json,result_json) VALUES ('w','c','command','{','[]')").run();
    const owner = DEV_SCHEMA_OWNERS.find((entry) => entry.owner === "nutrition")!;
    await assert.rejects(runMigrations(writer, owner.chain, owner.ledger), /CHECK/);
    assert.equal(old.prepare("SELECT count(*) AS n FROM nutrition_schema_migrations").get()?.n, 1);
    assert.equal(old.prepare("SELECT payload_json FROM nutrition_batch_commands").get()?.payload_json, "{");
    // Repair only this synthetic fixture explicitly, then finish the upgrade.
    old.exec("UPDATE nutrition_batch_commands SET payload_json = '[]'");
    for (const owner of DEV_SCHEMA_OWNERS) await runMigrations(writer, owner.chain, owner.ledger);
    assert.deepEqual(comparable(readSchema(old)), comparable(readSchema(fresh)));
    assert.equal(old.prepare("PRAGMA foreign_key_check").all().length, 0);
  } finally { old.close(); fresh.close(); }
});
