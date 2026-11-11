import assert from "node:assert/strict";
import test from "node:test";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createWorld, installFakeNative, type World } from "./support/restore-world.ts";
import { PRODUCTION_IDENTITY } from "../src/app/composition/productionDatabase.ts";
import { SCHEMA_OWNERS } from "../src/app/composition/schema.ts";
import { SqliteSnapshotEngine } from "../src/features/backup/data/SqliteSnapshotEngine.ts";
import { SnapshotError } from "../src/features/backup/domain/SnapshotManifest.ts";
import type { SnapshotSqlPort } from "../src/features/backup/data/SnapshotSqlPort.ts";
import { nodeSnapshotSql } from "../../../scripts/r06/NodeSnapshotSql.ts";
import { nodeSnapshotMediaSettings } from "../../../scripts/r06/NodeSnapshotMedia.ts";
import { backupBoundary, File } from "./support/expo-backup-boundary.ts";

/** BKP-AUDIT-1: the REAL pipeline (ExpoRestoreJobs → ExpoSqliteBackup → engine → journaled swap) over node:sqlite.
 * Expected values come from an independent oracle: rows read straight from SQLite before the backup was made. */
const HASH = "SELECT type, name, tbl_name, sql FROM sqlite_master";
const count = (needle: string, starts = false) => backupBoundary.queries.filter((q) => starts ? q.startsWith(needle) : q.includes(needle)).length;

async function withWorld(options: Parameters<typeof createWorld>[0], run: (world: World) => Promise<void>): Promise<void> {
  const world = await createWorld(options);
  try { await run(world); } finally { world.cleanup(); }
}
async function restore(world: World, file: File) {
  backupBoundary.picked = file;
  const preview = await world.jobs.prepareFile();
  assert.ok(preview);
  return { preview, outcome: await world.jobs.apply(preview.id) };
}
function mutateCopy(world: World, source: File, name: string, sql: string): File {
  const target = join(world.dirs.external, name); copyFileSync(new URL(source.uri), target);
  const db = new DatabaseSync(target);
  try { db.exec(sql); } finally { db.close(); }
  return new File(target);
}
const rejectionCode = async (world: World, file: File) => {
  backupBoundary.picked = file;
  try { await world.jobs.prepareFile(); } catch (error) { return (error as { code?: string }).code; }
  return "ACCEPTED";
};

for (const mode of ["manual", "automatic"] as const) {
  test(`BKP-AUDIT-1 ${mode} backup restores byte-for-byte equal business data, photos included`, async () => {
    await withWorld({ clients: 10, recipes: 40, photos: 4 }, async (world) => {
      const backup = await world.makeBackup(mode);
      world.write("UPDATE clients SET display_name='changed after backup' WHERE id='synthetic-1'");
      world.write("DELETE FROM recipes WHERE id='recipe-000003'");
      assert.notDeepEqual(world.tables(), backup.tables);
      const { preview, outcome } = await restore(world, backup.file);
      assert.equal(outcome, "COMMITTED");
      assert.equal(preview.kind, "RESTORE");
      assert.deepEqual(preview.activeClients + preview.archivedClients, 10);
      const after = world.tables();
      assert.deepEqual(after.clients, backup.tables.clients);
      // photo URIs are relocated by design; everything else of every recipe must be identical.
      const strip = (rows: readonly unknown[]) => rows.map((row) => { const r = { ...(row as Record<string, unknown>) };
        const details = JSON.parse(String(r.details_json)); delete details.photoUri; r.details_json = JSON.stringify(details); return r; });
      assert.deepEqual(strip(after.recipes), strip(backup.tables.recipes));
      const photoRows = after.recipes.filter((row) => JSON.parse(String((row as { details_json: string }).details_json)).photoUri !== null);
      assert.equal(photoRows.length, 4);
    });
  });
}

test("BKP-AUDIT-1 D1: a backup from a NEWER app version says so instead of «cannot read the file»", async () => {
  await withWorld({}, async (world) => {
    const backup = await world.makeBackup("automatic");
    const newer = mutateCopy(world, backup.file, "newer.atbackup", "UPDATE app_database_identity SET format_version = 2");
    assert.equal(await rejectionCode(world, newer), "RESTORE_NEWER_BACKUP");
  });
});

test("BKP-AUDIT-1 D1: foreign/incompatible and tampered backups are INVALID, never «source unavailable»", async () => {
  await withWorld({}, async (world) => {
    const backup = await world.makeBackup("manual");
    const foreign = mutateCopy(world, backup.file, "foreign.atbackup", "PRAGMA application_id = 12345");
    assert.equal(await rejectionCode(world, foreign), "RESTORE_INVALID_BACKUP");
    const tampered = mutateCopy(world, backup.file, "tampered.atbackup", "UPDATE clients SET display_name='tampered'");
    assert.equal(await rejectionCode(world, tampered), "RESTORE_INVALID_BACKUP");
    assert.equal(await rejectionCode(world, new File(world.dirs.external, "missing.atbackup")), "RESTORE_SOURCE_UNAVAILABLE");
    // LIVE untouched by every rejection.
    assert.deepEqual(world.tables(), backup.tables);
  });
});

test("BKP-AUDIT-1 low disk space is reported as such and keeps LIVE", async () => {
  await withWorld({}, async (world) => {
    const backup = await world.makeBackup("manual");
    backupBoundary.freeBytes = 1024;
    assert.equal(await rejectionCode(world, backup.file), "RESTORE_NO_SPACE");
    assert.deepEqual(world.tables(), backup.tables);
  });
});

test("BKP-AUDIT-1 D3: showing the screen (readPoint) never runs a full content pass", async () => {
  await withWorld({ recipes: 200 }, async (world) => {
    const backup = await world.makeBackup("manual");
    await restore(world, backup.file);
    backupBoundary.queries.length = 0;
    const point = await world.jobs.readPoint();
    assert.ok(point, "a return point exists after a restore");
    assert.equal(count(HASH, true), 0, "readPoint must use the cheap byte check, not a canonical re-hash");
    assert.equal(count("integrity_check"), 0);
  });
});

test("BKP-AUDIT-1 D5/D6: whole restore stays within the hash-pass and integrity-check budget", async () => {
  await withWorld({ recipes: 300, photos: 2 }, async (world) => {
    const backup = await world.makeBackup("manual");
    world.write("UPDATE clients SET display_name='x' WHERE id='synthetic-0'");
    backupBoundary.queries.length = 0;
    const { outcome } = await restore(world, backup.file);
    await world.jobs.readPoint();
    assert.equal(outcome, "COMMITTED");
    assert.ok(count(HASH, true) <= 3, `canonical content passes: ${count(HASH, true)} (budget 3: candidate, point seal, point verify)`);
    // Было 26 (build51). Остаток — независимые проверки: источник, кандидат, рабочая база, снимок точки возврата и два чтения при замене.
    assert.ok(count("integrity_check") <= 12, `integrity checks: ${count("integrity_check")} (budget 12, build51 had 26)`);
  });
});

test("BKP-AUDIT-1 a business write between preview and confirmation makes the preview stale and changes nothing", async () => {
  await withWorld({}, async (world) => {
    const backup = await world.makeBackup("manual");
    backupBoundary.picked = backup.file;
    const preview = await world.jobs.prepareFile(); assert.ok(preview);
    world.write("UPDATE clients SET display_name='written after preview' WHERE id='synthetic-0'");
    const live = world.tables();
    await assert.rejects(world.jobs.apply(preview.id), (error: unknown) => (error as { code?: string }).code === "RESTORE_STALE_PREVIEW");
    assert.deepEqual(world.tables(), live);
  });
});

test("BKP-AUDIT-1 restore is repeatable: a second restore of the same file after the first one commits again", async () => {
  await withWorld({ clients: 6, recipes: 10 }, async (world) => {
    const backup = await world.makeBackup("manual");
    assert.equal((await restore(world, backup.file)).outcome, "COMMITTED");
    world.write("UPDATE clients SET display_name='second round' WHERE id='synthetic-2'");
    assert.equal((await restore(world, backup.file)).outcome, "COMMITTED");
    assert.deepEqual(world.tables().clients, backup.tables.clients);
  });
});

test("BKP-AUDIT-1 C1: the photo relocation is verified without a second full hash — any extra row change rejects the candidate", async () => {
  await withWorld({ recipes: 6, photos: 2 }, async (world) => {
    const backup = await world.makeBackup("manual");
    for (const hostile of [false, true]) {
      const candidate = join(world.dirs.external, `candidate-${hostile}.db`);
      copyFileSync(new URL(backup.file.uri), candidate);
      const db = new DatabaseSync(candidate);
      try {
        const port = nodeSnapshotSql(db);
        // «Подставной триггер»: после UPDATE рецепта меняется ещё одна строка — total_changes() вырастает больше числа фото.
        const spy: SnapshotSqlPort = { ...port, transaction: (task) => port.transaction((tx) => task({ ...tx,
          run: async (sql, bindings) => {
            const result = await tx.run(sql, bindings);
            if (hostile && sql.startsWith("UPDATE recipes")) await tx.run("UPDATE clients SET display_name='hostile' WHERE id='synthetic-0'");
            return result;
          } })) };
        const engine = new SqliteSnapshotEngine({ identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS });
        const settings = nodeSnapshotMediaSettings({ mediaRoot: world.dirs.images, restoreId: randomUUID() });
        if (hostile) {
          await assert.rejects(engine.stageSnapshot(spy, settings), (error: unknown) => error instanceof SnapshotError && error.code === "SNAPSHOT_INVALID");
          assert.equal(db.prepare("SELECT display_name FROM clients WHERE id='synthetic-0'").get()?.display_name, "Synthetic 0", "the transaction rolled back");
        } else {
          await engine.stageSnapshot(spy, settings);
          const rows = db.prepare("SELECT id, details_json FROM recipes ORDER BY id").all().map((row) => ({ id: String(row.id), details: JSON.parse(String(row.details_json)) }));
          assert.equal(rows.filter((row) => String(row.details.photoUri ?? "").includes("restore-")).length, 2, "both photos were relocated to private restore-* files");
          assert.deepEqual(db.prepare("SELECT * FROM clients ORDER BY id").all().map((row) => ({ ...row })), backup.tables.clients, "nothing but photo URIs changed");
          assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'at_backup_%'").get()?.n, 0, "snapshot-only tables are gone");
        }
      } finally { db.close(); }
    }
  });
});

/** C5: нативный хеш подключён за портом; JS остаётся арбитром, а самопроверка на золотой фикстуре отключает ложный native. */
test("BKP-AUDIT-1 C5: with a correct native hash the whole round-trip needs no JS content pass", async () => {
  const fake = installFakeNative("correct");
  try {
    await withWorld({ recipes: 80, photos: 2 }, async (world) => {
      backupBoundary.queries.length = 0;
      const backup = await world.makeBackup("manual");
      world.write("UPDATE clients SET display_name='changed' WHERE id='synthetic-0'");
      const { outcome } = await restore(world, backup.file);
      assert.equal(outcome, "COMMITTED");
      assert.deepEqual(world.tables().clients, backup.tables.clients);
      assert.equal(count(HASH, true), 0, "every canonical pass went to the native module");
      assert.ok(fake.calls.fixture === 1 && fake.calls.real >= 3, `fixture self-check once, real passes ${fake.calls.real}`);
    });
  } finally { fake.remove(); }
});

for (const mode of ["wrong", "throws"] as const) {
  test(`BKP-AUDIT-1 C5: a ${mode} native module is neutralised — copies are still created, verified and restored by the JS protocol`, async () => {
    const fake = installFakeNative(mode);
    try {
      await withWorld({ recipes: 30 }, async (world) => {
        backupBoundary.queries.length = 0;
        const backup = await world.makeBackup("automatic");
        const { outcome } = await restore(world, backup.file);
        assert.equal(outcome, "COMMITTED");
        assert.deepEqual(world.tables().clients, backup.tables.clients);
        assert.equal(fake.calls.real, 0, "self-check failed, so the native module is never asked about real data");
        assert.ok(count(HASH, true) >= 3, "the JS path did the work");
      });
    } finally { fake.remove(); }
  });
}

test("BKP-AUDIT-1 C5: a native module that lies on real data cannot condemn a good backup, nor accept a tampered one", async () => {
  await withWorld({ recipes: 30 }, async (world) => {
    const backup = await world.makeBackup("manual"); // created by JS (no native yet)
    const tampered = mutateCopy(world, backup.file, "lies-tampered.atbackup", "UPDATE clients SET display_name='tampered'");
    const fake = installFakeNative("lies");
    try {
      backupBoundary.queries.length = 0;
      assert.equal((await restore(world, backup.file)).outcome, "COMMITTED", "native says «mismatch», JS arbitrates and accepts the intact backup");
      assert.ok(count(HASH, true) >= 1, "JS recomputed after the native mismatch");
      assert.equal(await rejectionCode(world, tampered), "RESTORE_INVALID_BACKUP", "JS rejects the tampered backup");
      assert.deepEqual(world.tables().clients, backup.tables.clients);
    } finally { fake.remove(); }
  });
});

test("BKP-AUDIT-1: a truncated or empty backup file is rejected and LIVE stays untouched", async () => {
  await withWorld({ recipes: 60 }, async (world) => {
    const backup = await world.makeBackup("manual");
    const bytes = readFileSync(new URL(backup.file.uri));
    for (const [name, size] of [["half", Math.floor(bytes.length / 2)], ["header-only", 100], ["empty", 0]] as const) {
      const path = join(world.dirs.external, `truncated-${name}.atbackup`);
      writeFileSync(path, bytes.subarray(0, size));
      const code = await rejectionCode(world, new File(path));
      assert.ok(code === "RESTORE_INVALID_BACKUP" || code === "RESTORE_SOURCE_UNAVAILABLE", `${name}: ${code}`);
      assert.notEqual(code, "ACCEPTED");
    }
    assert.deepEqual(world.tables(), backup.tables);
  });
});
