import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectDatabaseIdentity, type DatabaseIdentity, type DatabaseOwnerCatalog } from "../apps/mobile/src/shared/db/DatabaseIdentity.ts";
import { runMigrationsInTransaction } from "../apps/mobile/src/shared/db/MigrationRunner.ts";
import { SharedSqliteDatabase } from "../apps/mobile/src/shared/db/SharedSqliteDatabase.ts";
import { inspectProductionDatabase, prepareProductionDatabase } from "../apps/mobile/src/app/composition/productionDatabase.ts";
import { SCHEMA_OWNERS } from "../apps/mobile/src/app/composition/schema.ts";
import { SqliteSnapshotEngine } from "../apps/mobile/src/features/backup/data/SqliteSnapshotEngine.ts";
import { snapshotContentSha256 } from "../apps/mobile/src/features/backup/data/SnapshotContentHash.ts";
import { HEALTH_OWNER } from "../apps/mobile/src/features/health/data/HealthCatalog.ts";
import { nodeSqlitePort } from "./support/node-sqlite-port.ts";
import { nodeSnapshotSql } from "./r06/NodeSnapshotSql.ts";
import { canonicalContentSha256 } from "./r06/SqliteBackup.ts";

const old = JSON.parse(readFileSync(new URL("./fixtures/build47-schema.json", import.meta.url), "utf8")) as {
  identity: DatabaseIdentity; owners: readonly DatabaseOwnerCatalog[];
};
async function build47(db: DatabaseSync) {
  const port = nodeSqlitePort(db);
  await port.exclusive(async (tx) => {
    await tx.run("CREATE TABLE app_database_identity (id INTEGER PRIMARY KEY CHECK (id=1), product TEXT NOT NULL, format_version INTEGER NOT NULL CHECK(format_version>0), workspace_id TEXT NOT NULL)");
    await tx.run("INSERT INTO app_database_identity VALUES (1, ?, ?, ?)", [old.identity.product, old.identity.formatVersion, old.identity.workspaceId]);
    await tx.run(`PRAGMA application_id=${old.identity.applicationId}`);
    for (const owner of old.owners) await runMigrationsInTransaction(tx, owner.chain, owner.ledger);
    await tx.run("INSERT INTO workspaces VALUES (?, 'Synthetic', '2026-11-03')", [old.identity.workspaceId]);
    await tx.run("INSERT INTO clients (id,workspace_id,display_name,lifecycle,revision,created_at,updated_at) VALUES ('synthetic',?,'Synthetic recovery','ACTIVE',1,'2026-11-03','2026-11-03')", [old.identity.workspaceId]);
    await tx.run("INSERT INTO training_sessions (id,workspace_id,client_id,program_id,week_index,planned_workout_id,actual_date,revision,created_at,updated_at) VALUES ('session',?,'synthetic','program',1,'workout','2026-11-03',1,'2026-11-03','2026-11-03')", [old.identity.workspaceId]);
    await tx.run("INSERT INTO training_performed_sets (id,workspace_id,session_id,planned_set_id,planned_exercise_id,exercise_id,position,set_type,rpe,origin,revision,updated_at,sided) VALUES ('set',?,'session','planned-set','exercise','sys:synthetic',0,'NORMAL',8,'INPUT',1,'2026-11-03',1)", [old.identity.workspaceId]);
    for (const side of ["L", "R"]) await tx.run("INSERT INTO training_performed_sides (workspace_id,set_id,side,reps,load_grams) VALUES (?,'set',?,10,15000)", [old.identity.workspaceId, side]);
  });
}

test("RECOVERY-50: actual build47 catalogs open and upgrade; training identities, values and side RPE survive", async () => {
  const directory = mkdtempSync(join(tmpdir(), "build47-upgrade-")); const file = join(directory, "copy.db");
  const db = new DatabaseSync(file);
  try {
    await build47(db);
    const before = db.prepare("SELECT * FROM training_performed_sets").all();
    const strictOwners = SCHEMA_OWNERS.map(({ owner, ledger, chain }) => ({ owner, ledger, chain }));
    await assert.rejects(inspectDatabaseIdentity(nodeSqlitePort(db), old.identity, strictOwners), /DATABASE_INCOMPATIBLE/u,
      "the previous startup gate rejects a valid database before it can add the new health owner");
    assert.equal(await inspectProductionDatabase(nodeSqlitePort(db)), "OWNED");
    const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(new DatabaseSync(file)));
    await prepareProductionDatabase(shared);
    assert.deepEqual(db.prepare("SELECT * FROM training_performed_sets").all(), before);
    assert.deepEqual(db.prepare("SELECT side,rpe,reps,load_grams FROM training_performed_sides ORDER BY side").all().map((row) => ({ ...row })),
      [{ side: "L", rpe: 8, reps: 10, load_grams: 15000 }, { side: "R", rpe: 8, reps: 10, load_grams: 15000 }]);
    assert.equal(await inspectProductionDatabase(nodeSqlitePort(db)), "OWNED");
    assert.equal(db.prepare("SELECT count(*) AS n FROM health_schema_migrations").get()?.n, 1);
    assert.equal(db.prepare("SELECT display_name FROM clients").get()?.display_name, "Synthetic recovery");
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("RECOVERY-50: build47 snapshot validates and stages with the current engine without changing its source", async () => {
  const directory = mkdtempSync(join(tmpdir(), "build47-stage-"));
  const source = join(directory, "source.db"); const file = join(directory, "stage.db");
  const db = new DatabaseSync(source);
  try {
    await build47(db);
    const legacy = new SqliteSnapshotEngine(old);
    const current = new SqliteSnapshotEngine({ identity: old.identity, owners: SCHEMA_OWNERS });
    const metadata = { backupId: "10000000-0000-4000-8000-000000000047", createdAt: "2026-11-03T10:00:00.000Z" };
    await legacy.sealSnapshot(nodeSnapshotSql(db), metadata);
    const original = readFileSync(source);
    await current.validateSnapshot(nodeSnapshotSql(db));
    await backup(db, file);
    const candidate = new DatabaseSync(file);
    try {
      await current.stageSnapshot(nodeSnapshotSql(candidate));
      assert.equal(await inspectProductionDatabase(nodeSqlitePort(candidate)), "OWNED");
      assert.equal(candidate.prepare("SELECT count(*) AS n FROM training_performed_sides").get()?.n, 2);
    } finally { candidate.close(); }
    assert.deepEqual(readFileSync(source), original);
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("RECOVERY-50: absent additive owner never permits partial health tables or missing original ledgers", async () => {
  for (const invalid of [HEALTH_OWNER.chain[0]!.statements[0]!, "DROP TABLE settings_schema_migrations"]) {
    const db = new DatabaseSync(":memory:");
    try { await build47(db); db.exec(invalid); await assert.rejects(inspectProductionDatabase(nodeSqlitePort(db)), /DATABASE_INCOMPATIBLE/u); }
    finally { db.close(); }
  }
});

test("RECOVERY-50: composite-key tables hash in bounded pages with exact legacy bytes and no per-row native calls", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE facts (workspace TEXT, set_id TEXT, side TEXT, reps INTEGER, PRIMARY KEY(workspace,set_id,side)); BEGIN");
    const insert = db.prepare("INSERT INTO facts VALUES ('w', ?, ?, ?)");
    for (let i = 0; i < 2501; i++) insert.run(`s${i >> 1}`, i % 2 ? "R" : "L", i % 30);
    db.exec("COMMIT");
    const port = nodeSnapshotSql(db); let calls = 0; const pages: string[] = [];
    const batched = { ...port, all: async <Row>(sql: string, args?: Parameters<typeof port.all>[1]) => {
      calls++; if (sql.startsWith("SELECT typeof")) pages.push(sql); return port.all<Row>(sql, args);
    },
      each<Row>(): AsyncIterable<Row> { throw new Error("PER_ROW_BRIDGE_REGRESSION"); } };
    assert.equal(await snapshotContentSha256(batched), canonicalContentSha256(db));
    assert.ok(calls < 15, `native calls=${calls} for 2501 rows`);
    assert.ok(pages.length >= 6);
    assert.ok(pages.every((sql) => !sql.includes("OFFSET")), "composite primary keys must not re-scan prior pages");
    assert.ok(pages.slice(1).every((sql) => sql.includes("WHERE (")), "later pages use an indexed tuple seek");
  } finally { db.close(); }
});
