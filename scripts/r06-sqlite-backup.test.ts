import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalContentSha256, createSqliteBackup, prepareBackupForRestore, SnapshotError, validateSqliteBackup } from "./r06/SqliteBackup.ts";
import { HostRestoreStorage } from "./r06/HostRestoreStorage.ts";
import { GuardedRestore } from "../apps/mobile/src/features/backup/public.ts";
import { prepareProductionDatabase, inspectProductionDatabase, PRODUCTION_WORKSPACE_ID as WS } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { DevClientRepository } from "../apps/mobile/src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository } from "../apps/mobile/src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { DevMeasurementRepository } from "../apps/mobile/src/features/measurements/data/DevMeasurementRepository.ts";
import { DevSettingsRepository } from "../apps/mobile/src/features/settings/data/DevSettingsRepository.ts";
import { DevFoodCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevFoodCatalogRepository.ts";
import { DevRecipeCatalogRepository } from "../apps/mobile/src/features/nutrition/data/DevRecipeCatalogRepository.ts";
import { DevNutritionDiaryRepository } from "../apps/mobile/src/features/nutrition/data/DevNutritionDiaryRepository.ts";
import { snapshotOfFood } from "../apps/mobile/src/features/nutrition/domain/FoodSnapshot.ts";
import { DevTrainingExecutionRepository } from "../apps/mobile/src/features/training/execution/data/DevTrainingExecutionRepository.ts";

const NOW = new Date("2026-10-20T09:00:00.000Z");
const metadata = () => ({ backupId: randomUUID(), createdAt: NOW.toISOString() });
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const code = (expected: SnapshotError["code"]) => (error: unknown) => error instanceof SnapshotError && error.code === expected;
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "athlete-backup-"));
  const file = join(directory, "source.db");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(file)));
  await prepareProductionDatabase(shared);
  return { directory, file, shared, partial: join(directory, "copy.partial"), destination: join(directory, "copy.atbackup"), staging: join(directory, "staging.db"),
    cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
async function seed(shared: SharedSqliteDatabase) {
  const clients = new DevClientRepository(shared, WS, []);
  const measurements = new DevMeasurementRepository(shared, WS);
  const settings = new DevSettingsRepository(shared, WS);
  const foods = new DevFoodCatalogRepository(shared, WS);
  const recipes = new DevRecipeCatalogRepository(shared, WS);
  const diary = new DevNutritionDiaryRepository(shared, WS);
  const execution = new DevTrainingExecutionRepository(shared, WS);
  const stores = [clients, measurements, settings, foods, recipes, diary, execution];
  try {
    for (const store of stores) await store.initialize();
    const client = await clients.create({ displayName: "Synthetic roundtrip", emoji: "🏋️" });
    await measurements.record(client.id, { type: "WEIGHT", valueX10: 805, localDate: "2026-10-20", localMinute: null }, NOW);
    await measurements.record(client.id, { type: "WAIST", valueX10: 810, localDate: "2026-10-19", localMinute: 540 }, NOW);
    await settings.saveAppearance({ themeId: "slate-blue", accentId: null });
    const food = await foods.create({ name: "Synthetic food", brand: null, unit: "G", amountX10: 1000,
      kcalX10: 1000, proteinX10: 100, fatX10: 20, carbsX10: 120 }, NOW);
    await recipes.create({ name: "Synthetic recipe", servingsX10: 20, cookedMassX10: 2000,
      ingredients: [{ foodId: food.id, quantityX10: 1000 }] }, NOW);
    await diary.addEntry(client.id, { localDate: "2026-10-20", slot: "BREAKFAST", snapshot: snapshotOfFood(food, 1000) }, NOW);
    await execution.saveSet({ slot: { clientId: client.id, programId: "synthetic-program", weekIndex: 1, plannedWorkoutId: "workout-a" },
      plannedExerciseId: "exercise-a", exerciseId: "sys:synthetic-catalog-id", plannedSetId: "set-a", position: 0, metrics: ["load", "reps"],
      values: { reps: 20, loadGrams: 10000, durationSec: null, distanceM: null }, drops: [], rpe: null,
      setType: "NORMAL", expectedRevision: null }, NOW);
    return { clientId: client.id };
  } finally { for (const store of stores.reverse()) await store.close(); }
}

test("P01 native .atbackup preserves navigation links including archived participants", async () => {
  const f = await fixture();
  const clients = new DevClientRepository(f.shared, WS, []);
  const plans = new DevTrainingPlansRepository(f.shared, WS);
  try {
    await clients.initialize(); await plans.initialize();
    const a = await clients.create({ displayName: "Synthetic navigation A" });
    const b = await clients.create({ displayName: "Synthetic navigation B" });
    const workout = { id: "qa-workout", title: "Workout", exercises: [{ id: "qa-exercise", exerciseId: "sys:qa", rir: null, restSec: null, instruction: null,
      sets: [{ id: "qa-set", reps: 10, repsMax: null, loadGrams: 20000, durationSec: null, distanceM: null }] }] };
    const program = await plans.createPeriodizedProgram({ title: "Navigation", clientIds: [a.id, b.id],
      placements: [{ clientId: b.id, target: { kind: "new" } }], mesocycle: { title: "Block", cycleType: null,
        repRange: null, startDate: null, weeks: [{ type: "base", workouts: [workout] }] } });
    const cycle = (await plans.getPeriodizedPlan(a.id, program.id))!.mesocycles[0]!;
    const members = await plans.getMesocycleGroup(a.id, program.id, { mesocycleId: cycle.id });
    await plans.archiveForClient(b.id, members.find((item) => item.clientId === b.id)!.programId);
    const source = new DatabaseSync(f.file);
    try {
      const expected = canonicalContentSha256(source);
      await createSqliteBackup(source, f.partial, f.destination, metadata());
      await prepareBackupForRestore(f.destination, f.staging);
      const restored = new DatabaseSync(f.staging, { readOnly: true });
      try {
        assert.equal(canonicalContentSha256(restored), expected);
        for (const table of ["training_navigation_groups", "training_navigation_members"]) {
          assert.deepEqual(restored.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(), source.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());
        }
        assert.equal(restored.prepare("SELECT count(*) AS n FROM training_navigation_members").get()!.n, 2);
        assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
      } finally { restored.close(); }
    } finally { source.close(); }
  } finally { await plans.close(); await clients.close(); f.cleanup(); }
});

test("R06 single real SQLite .atbackup roundtrips populated facts/settings and stays independent of source", async () => {
  const f = await fixture();
  try {
    await seed(f.shared);
    const source = new DatabaseSync(f.file);
    const sourceBytes = readFileSync(f.file);
    const expected = canonicalContentSha256(source);
    const m = await createSqliteBackup(source, f.partial, f.destination, metadata());
    source.close();
    assert.deepEqual(readFileSync(f.file), sourceBytes, "no manifest or DDL is written to live");
    assert.equal(m.contentSha256, expected);
    assert.equal(readFileSync(f.destination).subarray(0, 16).toString(), "SQLite format 3\0");
    const originalBackup = readFileSync(f.destination);
    const raw = new DatabaseSync(f.destination, { readOnly: true });
    await assert.rejects(inspectProductionDatabase(nodeSqlitePort(raw)), /DATABASE_INCOMPATIBLE/u);
    raw.close();
    // Simulate losing the entire original install; one .atbackup is all that remains.
    rmSync(f.file);
    assert.deepEqual(await validateSqliteBackup(f.destination), m);
    assert.deepEqual(await prepareBackupForRestore(f.destination, f.staging), m);
    const staged = new DatabaseSync(f.staging, { readOnly: true });
    try {
      assert.equal(await inspectProductionDatabase(nodeSqlitePort(staged)), "OWNED");
      assert.equal(canonicalContentSha256(staged), expected);
      assert.equal(staged.prepare("SELECT count(*) AS n FROM body_measurements").get()?.n, 2);
      assert.equal(staged.prepare("SELECT count(*) AS n FROM food_diary_entries").get()?.n, 1);
    } finally { staged.close(); }
    assert.deepEqual(readFileSync(f.destination), originalBackup);
  } finally { f.cleanup(); }
});

test("R06 native SQLite backup captures committed WAL pages without checkpointing/altering live", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.file);
  try {
    db.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE workspaces SET display_name='committed WAL only'");
    const main = readFileSync(f.file); const wal = readFileSync(`${f.file}-wal`);
    const m = await createSqliteBackup(db, f.partial, f.destination, metadata());
    assert.deepEqual(readFileSync(f.file), main);
    assert.deepEqual(readFileSync(`${f.file}-wal`), wal);
    await prepareBackupForRestore(f.destination, f.staging);
    const copy = new DatabaseSync(f.staging, { readOnly: true });
    try {
      assert.equal(copy.prepare("SELECT display_name FROM workspaces").get()?.display_name, "committed WAL only");
      assert.equal(canonicalContentSha256(copy), m.contentSha256);
    } finally { copy.close(); }
  } finally { db.close(); f.cleanup(); }
});

test("R06 shared repository leases close before replacement and reinitialize against the restored file", async () => {
  const f = await fixture();
  const storage = new HostRestoreStorage(f.directory);
  const liveDatabase = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(storage.path("LIVE"))));
  const clients = new DevClientRepository(liveDatabase, WS, []);
  try {
    const historic = await seed(f.shared);
    const db = new DatabaseSync(f.file);
    await createSqliteBackup(db, f.partial, f.destination, metadata()); db.close();
    await prepareProductionDatabase(liveDatabase);
    await clients.initialize();
    const newer = await clients.create({ displayName: "Synthetic newer client" });
    await prepareBackupForRestore(f.destination, storage.path("INCOMING"));
    const hostGate = storage.withClosedDatabase.bind(storage);
    storage.withClosedDatabase = (task) => liveDatabase.withClosedDatabase(() => clients.close(), () => hostGate(task));
    assert.equal(await new GuardedRestore(storage).restore({ operationId: "live-lease-rehearsal",
      currentSha256: hash(storage.path("LIVE")), incomingSha256: hash(storage.path("INCOMING")) }), "COMMITTED");
    await clients.initialize();
    assert.equal(await clients.get(newer.id), null);
    assert.equal((await clients.get(historic.clientId))?.displayName, "Synthetic roundtrip");
    const safety = new DatabaseSync(storage.path("SAFETY"), { readOnly: true });
    try { assert.equal(safety.prepare("SELECT display_name FROM clients WHERE id=?").get(newer.id)?.display_name, "Synthetic newer client"); }
    finally { safety.close(); }
  } finally { await clients.close(); f.cleanup(); }
});

test("R06 backup→validated staging→guarded replacement restores the historical snapshot, not a merge", async () => {
  const f = await fixture();
  const storage = new HostRestoreStorage(f.directory);
  try {
    const db = new DatabaseSync(f.file);
    const m = await createSqliteBackup(db, f.partial, f.destination, metadata()); db.close();
    const current = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(storage.path("LIVE"))));
    await prepareProductionDatabase(current);
    const live = new DatabaseSync(storage.path("LIVE"));
    live.exec("UPDATE workspaces SET display_name='newer current state'"); live.close();
    const before = readFileSync(storage.path("LIVE"));
    await prepareBackupForRestore(f.destination, storage.path("INCOMING"));
    const result = await new GuardedRestore(storage).restore({ operationId: "roundtrip", currentSha256: hash(storage.path("LIVE")), incomingSha256: hash(storage.path("INCOMING")) });
    assert.equal(result, "COMMITTED");
    const restored = new DatabaseSync(storage.path("LIVE"), { readOnly: true });
    try { assert.equal(canonicalContentSha256(restored), m.contentSha256); }
    finally { restored.close(); }
    assert.deepEqual(readFileSync(storage.path("SAFETY")), before);
  } finally { f.cleanup(); }
});

for (const kind of ["row corruption", "manifest version", "manifest missing", "unknown table", "unknown schema ledger"] as const) {
  test(`R06 ${kind} never creates restore candidate or alters the source copy`, async () => {
    const f = await fixture();
    try {
      const db = new DatabaseSync(f.file);
      await createSqliteBackup(db, f.partial, f.destination, metadata()); db.close();
      const tampered = new DatabaseSync(f.destination);
      if (kind === "row corruption") tampered.exec("UPDATE workspaces SET display_name='different fact'");
      if (kind === "manifest version") tampered.exec("UPDATE at_backup_manifest SET json=json_set(json,'$.formatVersion',4)");
      if (kind === "manifest missing") tampered.exec("DELETE FROM at_backup_manifest");
      if (kind === "unknown table") tampered.exec("CREATE TABLE surprise (id TEXT)");
      if (kind === "unknown schema ledger") tampered.exec("UPDATE clients_schema_migrations SET checksum='wrong'");
      tampered.close();
      const sourceBytes = readFileSync(f.destination);
      await assert.rejects(prepareBackupForRestore(f.destination, f.staging), code("SNAPSHOT_INVALID"));
      assert.equal(existsSync(f.staging), false);
      assert.deepEqual(readFileSync(f.destination), sourceBytes);
    } finally { f.cleanup(); }
  });
}

test("R06 external recipe photo is blocked until bytes are backed up; no false success or replaced backup", async () => {
  const f = await fixture();
  try {
    await seed(f.shared);
    const db = new DatabaseSync(f.file);
    try {
      db.exec(`UPDATE recipes SET details_json='{"prepMinutes":null,"cookMinutes":null,"categories":[],"steps":[],"photoUri":"file:///old-install/only-image.jpg"}'`);
      await assert.rejects(createSqliteBackup(db, f.partial, f.destination, metadata()), code("SNAPSHOT_INCOMPLETE_MEDIA"));
      assert.equal(existsSync(f.destination), false);
      assert.ok(existsSync(f.partial), "private candidate retained, not published as successful backup");
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'at_backup_%'").get()?.n, 0);
    } finally { db.close(); }
  } finally { f.cleanup(); }
});

test("R06 existing manual backup, partial and staging are never overwritten", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.file);
  try {
    await assert.rejects(createSqliteBackup(db, f.destination, f.destination, metadata()), code("SNAPSHOT_DESTINATION_EXISTS"));
    assert.equal(existsSync(f.destination), false);
    writeFileSync(f.partial, "existing partial");
    await assert.rejects(createSqliteBackup(db, f.partial, f.destination, metadata()), code("SNAPSHOT_DESTINATION_EXISTS"));
    assert.equal(readFileSync(f.partial, "utf8"), "existing partial");
    rmSync(f.partial);
    await createSqliteBackup(db, f.partial, f.destination, metadata());
    const saved = readFileSync(f.destination);
    await assert.rejects(createSqliteBackup(db, f.partial, f.destination, metadata()), code("SNAPSHOT_DESTINATION_EXISTS"));
    assert.deepEqual(readFileSync(f.destination), saved);
    writeFileSync(f.staging, "existing staging");
    await assert.rejects(prepareBackupForRestore(f.destination, f.staging), code("SNAPSHOT_DESTINATION_EXISTS"));
    assert.equal(readFileSync(f.staging, "utf8"), "existing staging");
  } finally { db.close(); f.cleanup(); }
});

test("R06 typed streaming content checksum keeps exact int64, blobs, null/empty and duplicate multiplicity", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE atoms (a, b); INSERT INTO atoms VALUES (9223372036854775807, x'00ff'), (NULL,''), ('12',12), ('12',12)");
    const expected = canonicalContentSha256(db);
    db.exec("DELETE FROM atoms WHERE rowid=3");
    assert.notEqual(canonicalContentSha256(db), expected);
    db.exec("INSERT INTO atoms VALUES ('12',12)");
    assert.equal(canonicalContentSha256(db), expected);
    db.exec("UPDATE atoms SET a=9223372036854775806 WHERE typeof(a)='integer'");
    assert.notEqual(canonicalContentSha256(db), expected);
  } finally { db.close(); }
});
