import assert from "node:assert/strict";
import test from "node:test";
import { RestorePreparationTrace, RESTORE_PREPARATION_PHASES, type RestorePreparationProgress } from "../apps/mobile/src/features/backup/domain/RestorePreparation.ts";
import { DatabaseSync } from "node:sqlite";
import { snapshotContentSha256 } from "../apps/mobile/src/features/backup/data/SnapshotContentHash.ts";
import { nodeSnapshotSql } from "./r06/NodeSnapshotSql.ts";
import { canonicalContentSha256 } from "./r06/SqliteBackup.ts";

test("RECOVERY-51 preparation phases distinguish completed passes and ignore all events after finish", () => {
  const events: RestorePreparationProgress[] = []; const logs: string[] = []; let time = 0;
  const trace = new RestorePreparationTrace("synthetic-operation", (p) => events.push(p), () => time++, (line) => logs.push(line));
  trace.observe({ stage: "SNAPSHOT", done: null, total: null });
  trace.observe({ stage: "VERIFY", done: 0, total: 100 });
  for (let i = 1; i <= 100; i++) trace.observe({ stage: "VERIFY", done: i, total: 100 });
  trace.phase("PREPARE_CANDIDATE");
  trace.observe({ stage: "VERIFY", done: 0, total: 100 });
  trace.observe({ stage: "VERIFY", done: 100, total: 100 });
  trace.phase("VERIFY_CURRENT");
  trace.observe({ stage: "CONTENT", done: 1, total: 1 });
  trace.finish(true);
  assert.deepEqual([...new Set(events.map((p) => p.phase))], RESTORE_PREPARATION_PHASES);
  assert.ok(events.some((p) => p.phase === "VERIFY_SOURCE" && p.done === 100));
  assert.ok(events.some((p) => p.phase === "PREPARE_CANDIDATE" && p.done === 0));
  assert.deepEqual(events.at(-1), { phase: "READY", done: 1, total: 1 });
  const length = events.length; const logLength = logs.length;
  trace.observe({ stage: "VERIFY", done: 0, total: 5 }); trace.phase("COPY_SOURCE"); trace.finish(false);
  assert.equal(events.length, length); assert.equal(logs.length, logLength);
  assert.ok(logs.length < 25, "diagnostics log phase/10% boundaries, not every row");
  assert.ok(logs.every((line) => JSON.parse(line).operationId === "synthetic-operation"));
});

test("RECOVERY-51 composite seeks preserve int64 and binary order; unsafe keys still use the exact legacy fallback", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE exact (a INTEGER, b TEXT, value TEXT, PRIMARY KEY(a,b)) WITHOUT ROWID;
      CREATE TABLE nullable (a TEXT,b TEXT,value TEXT,PRIMARY KEY(a,b));
      CREATE TABLE nocase (a TEXT COLLATE NOCASE,b TEXT,value TEXT,PRIMARY KEY(a,b));
      CREATE TABLE nonprefix (a TEXT,value TEXT,b TEXT,PRIMARY KEY(a,b));
      CREATE TABLE mixed (a,b TEXT,value TEXT,PRIMARY KEY(a,b));
      INSERT INTO nullable VALUES (NULL,'a','1'),(NULL,'a','1');
      INSERT INTO nocase VALUES ('A','1','x'),('b','1','y');
      INSERT INTO nonprefix VALUES ('a','1','x'),('b','2','x');
      INSERT INTO mixed VALUES (1,'a','int'),('1','a','text'),(x'31','a','blob')`);
    const insert = db.prepare("INSERT INTO exact VALUES (?,?,?)");
    for (let i = 0; i < 1101; i++) insert.run(i % 2 ? 9223372036854775807n : -9223372036854775808n,
      `${i % 3 ? "Я" : "é"}${String(i).padStart(4, "0")}`, "Подход");
    const port = nodeSnapshotSql(db); const queries: string[] = [];
    const counted = { ...port, all: async <Row>(sql: string, args?: Parameters<typeof port.all>[1]) => {
      queries.push(sql); return port.all<Row>(sql, args);
    } };
    assert.equal(await snapshotContentSha256(counted), canonicalContentSha256(db));
    assert.ok(queries.some((sql) => sql.includes('FROM "exact" WHERE (') && sql.includes("CAST(? AS INTEGER)")));
    for (const table of ["nullable", "nocase", "nonprefix", "mixed"]) {
      assert.ok(queries.some((sql) => sql.includes(`FROM "${table}" ORDER BY`) && sql.includes("OFFSET")), table);
    }
  } finally { db.close(); }
});
