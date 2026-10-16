import assert from "node:assert/strict";
import test from "node:test";
import { LocalDiagnostics, type DiagnosticInput } from
  "../apps/mobile/src/shared/diagnostics/LocalDiagnostics.ts";
import type { SqliteConnectionPort, SqliteStatementPort } from
  "../apps/mobile/src/shared/db/SqlitePort.ts";
import { WriterCoordinator } from "../apps/mobile/src/shared/db/WriterCoordinator.ts";

const statements: SqliteStatementPort = {
  run: async () => ({ changes: 1, lastInsertRowId: 1 }),
  first: async () => null,
  all: async () => [],
};

const connection: SqliteConnectionPort = {
  ...statements,
  exclusive: async <T>(task: (tx: SqliteStatementPort) => Promise<T>): Promise<T> => task(statements),
  close: async () => {},
};

test("F10: recorder retains only allowlisted runtime fields in a bounded local buffer", () => {
  const recorder = new LocalDiagnostics(2);
  const first = { operation: "db.transaction", outcome: "committed", durationMs: 1.7,
    sql: "SELECT private_payload", clientId: "synthetic-private-client" } as DiagnosticInput;
  recorder.record(first);
  recorder.record({ operation: "db.transaction", outcome: "rolled-back", durationMs: Number.NaN, code: "DB_WRITE_FAILED" });
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.length, 2);
  assert.deepEqual(snapshot[0], { sequence: 1, operation: "db.transaction", outcome: "committed", durationMs: 2 });
  assert.equal(snapshot[1]?.durationMs, 0);
  assert.ok(!JSON.stringify(snapshot).includes("private_payload"));
  assert.ok(!JSON.stringify(snapshot).includes("synthetic-private-client"));
  recorder.record({ operation: "db.transaction", outcome: "rejected", durationMs: -100, code: "WRITES_QUIESCED" });
  assert.deepEqual(recorder.snapshot().map((event) => event.sequence), [2, 3]);
  recorder.clear();
  assert.deepEqual(recorder.snapshot(), []);
});

test("F10: diagnostics reject arbitrary operation and error codes", () => {
  const recorder = new LocalDiagnostics();
  assert.throws(() => recorder.record({ operation: "client.health" as "db.transaction", outcome: "committed", durationMs: 0 }), /DIAGNOSTIC_EVENT_INVALID/u);
  assert.throws(() => recorder.record({ operation: "db.transaction", outcome: "rolled-back", durationMs: 0,
    code: "private exception text" as "DB_WRITE_FAILED" }), /DIAGNOSTIC_EVENT_INVALID/u);
  assert.throws(() => new LocalDiagnostics(0), /DIAGNOSTIC_CAPACITY_INVALID/u);
});

test("F10: writer traces commit, rollback and quiescence without SQL or exception text", async () => {
  const recorder = new LocalDiagnostics();
  const writer = new WriterCoordinator(connection, recorder);
  assert.equal(await writer.write(async (tx) => { await tx.run("INSERT PRIVATE VALUE"); return "ok"; }), "ok");
  await assert.rejects(writer.write(async () => { throw new Error("sensitive workout and health payload"); }));
  const resume = await writer.quiesce();
  await assert.rejects(writer.write(async () => undefined), /WRITES_QUIESCED/u);
  resume();
  assert.deepEqual(recorder.snapshot().map((event) => [event.outcome, event.code ?? null]), [
    ["committed", null], ["rolled-back", "DB_WRITE_FAILED"], ["rejected", "WRITES_QUIESCED"],
  ]);
  const serialized = JSON.stringify(recorder.snapshot());
  assert.ok(!serialized.includes("PRIVATE VALUE"));
  assert.ok(!serialized.includes("sensitive workout"));
});

test("F10: a broken diagnostic sink cannot fail a committed write", async () => {
  const writer = new WriterCoordinator(connection, { record: () => { throw new Error("sink unavailable"); } });
  assert.equal(await writer.write(async () => "committed"), "committed");
});
