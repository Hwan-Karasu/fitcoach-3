import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
import { InspectionCopyError, inspectionOperationId, parseInspectionReceipt } from "../apps/mobile/src/features/legacy-import/domain/InspectionCopy.ts";
import { prepareLegacyInspectionCopy, readLegacyInspectionCopy, type LegacyInspectionReader } from "../apps/mobile/src/features/legacy-import/data/LegacyInspectionCopy.ts";
import { inspectionExpoMock } from "./support/inspection-expo-mock.ts";
import { seedLegacyBackupMetadata } from "./support/legacy-backup-metadata.ts";
import { LegacySourceAdmissionError } from "../apps/mobile/src/features/legacy-import/domain/LegacyBackupInventory.ts";

const operation = "11111111-1111-4111-8111-111111111111", retryOperation = "22222222-2222-4222-8222-222222222222";
const scope = "inspection-synthetic";
const digest = (path: string) => { const bytes = readFileSync(path); return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; };
async function fixture(run: (value: ReturnType<typeof setup>) => Promise<void>) {
  const value = setup();
  try { await run(value); } finally {
    const path = resolve(value.dir); assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith("athlete-r04-source-copy-")); rmSync(path, { recursive: true, force: true });
  }
}
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "athlete-r04-source-copy-")), source = join(dir, "selected.atbackup"), root = join(dir, "private");
  const db = new DatabaseSync(source);
  db.exec(`CREATE TABLE client_day_facts(client_id TEXT,date_key TEXT,weight TEXT,steps TEXT,training TEXT);
    INSERT INTO client_day_facts VALUES('a','2026-10-19','80.1',NULL,'Нет');
    CREATE TABLE source_data_not_yet_projected(payload TEXT); INSERT INTO source_data_not_yet_projected VALUES('untouched full-file data');`);
  seedLegacyBackupMetadata(db, scope); db.close();
  const calls: string[] = [], opened: string[] = [], queries: string[] = [];
  const state: { hook: ((phase: string) => void) | null } = { hook: null };
  const point = (phase: string) => { calls.push(phase); state.hook?.(phase); };
  const path = (op: string, name: string) => { assert.ok(inspectionOperationId(op)); return join(root, op, name); };
  const inspect = (file: string) => {
    if (!existsSync(file)) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    return { digest: digest(file), header: readFileSync(file).subarray(0, 16), hasSidecars: ["-wal", "-shm", "-journal"].some((suffix) => existsSync(file + suffix)) };
  };
  const files: LegacyInspectionReader = {
    async hashSource() { point("hash-source"); return digest(source); },
    async reserve(op) {
      point("reserve"); if (existsSync(join(root, op))) throw new InspectionCopyError("SOURCE_COPY_EXISTS");
      mkdirSync(root, { recursive: true }); mkdirSync(join(root, op)); writeFileSync(path(op, "source.partial"), "", { flag: "wx" }); point("after-reserve");
    },
    async copyToPartial(op) { point("copy"); copyFileSync(source, path(op, "source.partial")); point("after-copy"); },
    async inspectPartial(op) { point("inspect-partial"); return inspect(path(op, "source.partial")); },
    async seal(op, receipt) {
      point("seal"); renameSync(path(op, "source.partial"), path(op, "source.sqlite")); point("after-file-publish");
      writeFileSync(path(op, "receipt.partial"), JSON.stringify(receipt), { flag: "wx" }); point("after-receipt-write");
      renameSync(path(op, "receipt.partial"), path(op, "receipt.json")); point("after-receipt-publish");
    },
    async inspectReady(op) {
      point("inspect-ready"); if (!existsSync(path(op, "receipt.json"))) throw new InspectionCopyError("SOURCE_COPY_INVALID");
      return { ...inspect(path(op, "source.sqlite")), receipt: JSON.parse(readFileSync(path(op, "receipt.json"), "utf8")) as unknown };
    },
    async openReady(op) {
      point("open-sqlite"); const file = path(op, "source.sqlite"); opened.push(file); const connection = new DatabaseSync(file);
      return { getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => { queries.push(sql); return connection.prepare(sql).all(...bindings as SQLInputValue[]) as Row[]; },
        execAsync: async (sql: string) => { connection.exec(sql); }, closeAsync: async () => { connection.close(); point("after-sqlite-close"); } };
    },
  };
  return { dir, root, source, files, calls, opened, queries, state, path };
}

test("prepared SQLite copy is byte-identical, sealed, and the only file opened by the source collector", () => fixture(async (f) => {
  const original = readFileSync(f.source), expected = digest(f.source);
  const receipt = await prepareLegacyInspectionCopy(f.files, operation);
  assert.deepEqual({ sha256: receipt.sha256, bytes: receipt.bytes }, expected);
  assert.deepEqual(readFileSync(f.path(operation, "source.sqlite")), original);
  assert.equal(existsSync(f.path(operation, "source.partial")), false);
  assert.equal(f.opened.length, 0, "preparing a byte copy does not open SQLite");
  const actual = await readLegacyInspectionCopy(f.files, receipt);
  assert.equal(actual.admission.accountScope, scope); assert.equal(actual.admission.sourceWorkspaceId, "synthetic-workspace");
  assert.equal(actual.snapshots.nutrition.tables.client_day_facts![0]!.weight, "80.1");
  assert.deepEqual(actual.snapshots.measurements.clientDays, actual.snapshots.nutrition.tables.client_day_facts);
  assert.deepEqual(f.opened, [f.path(operation, "source.sqlite")]); assert.deepEqual(readFileSync(f.source), original);
  assert.deepEqual(digest(f.path(operation, "source.sqlite")), expected);
}));

test("invalid operation IDs and receipts cannot select arbitrary files", () => fixture(async (f) => {
  for (const op of ["../source", "", "ABCDEFAB-1111-4111-8111-111111111111", "file:///selected.atbackup", "11111111-1111-1111-8111-111111111111"]) {
    await assert.rejects(prepareLegacyInspectionCopy(f.files, op), { message: "SOURCE_COPY_INVALID" });
  }
  assert.equal(f.calls.length, 0);
  const receipt = await prepareLegacyInspectionCopy(f.files, operation);
  for (const raw of [{ ...receipt, extra: "unexpected" }, { ...receipt, bytes: -1 }, { ...receipt, operationId: "../selected.atbackup" }, { ...receipt, sha256: "bad" }]) {
    assert.throws(() => parseInspectionReceipt(raw), { message: "SOURCE_COPY_INVALID" });
  }
  assert.equal(Object.isFrozen(receipt), true);
}));

test("an existing operation slot is never overwritten", () => fixture(async (f) => {
  const receipt = await prepareLegacyInspectionCopy(f.files, operation), copy = readFileSync(f.path(operation, "source.sqlite")), metadata = readFileSync(f.path(operation, "receipt.json"));
  await assert.rejects(prepareLegacyInspectionCopy(f.files, operation), { message: "SOURCE_COPY_EXISTS" });
  assert.deepEqual(readFileSync(f.path(operation, "source.sqlite")), copy); assert.deepEqual(readFileSync(f.path(operation, "receipt.json")), metadata);
  assert.deepEqual((await readLegacyInspectionCopy(f.files, receipt)).receipt, receipt);
}));

test("a byte-perfect copied SQLite file cannot bypass source admission to collect domain rows", () => fixture(async (f) => {
  const db = new DatabaseSync(f.source); db.exec("UPDATE account_database_binding SET scope_key='wrong-owner'"); db.close();
  const original = readFileSync(f.source), receipt = await prepareLegacyInspectionCopy(f.files, operation);
  await assert.rejects(readLegacyInspectionCopy(f.files, receipt), (error) => error instanceof LegacySourceAdmissionError && error.inventory.reasons.includes("BINDING_UNVERIFIED"));
  assert.equal(f.queries.some((sql) => sql.startsWith('SELECT * FROM "')), false);
  assert.deepEqual(f.opened, [f.path(operation, "source.sqlite")]); assert.deepEqual(readFileSync(f.source), original);
}));

test("every copy/publication IO failure preserves the external source and permits a fresh-copy retry", async () => {
  const probe = setup(); let phases: string[];
  try { await prepareLegacyInspectionCopy(probe.files, operation); phases = [...probe.calls]; }
  finally { const path = resolve(probe.dir); assert.equal(dirname(path), resolve(tmpdir())); assert.ok(basename(path).startsWith("athlete-r04-source-copy-")); rmSync(path, { recursive: true, force: true }); }
  for (let failAt = 0; failAt < phases.length; failAt++) await fixture(async (f) => {
    const original = readFileSync(f.source); let position = 0;
    f.state.hook = () => { if (position++ === failAt) throw new Error("ENOSPC private source path"); };
    await assert.rejects(prepareLegacyInspectionCopy(f.files, operation), { message: "SOURCE_COPY_IO_FAILED" });
    assert.deepEqual(readFileSync(f.source), original); assert.equal(f.opened.length, 0);
    f.state.hook = null;
    const retry = await prepareLegacyInspectionCopy(f.files, retryOperation); assert.deepEqual({ sha256: retry.sha256, bytes: retry.bytes }, digest(f.source));
    await readLegacyInspectionCopy(f.files, retry); assert.deepEqual(readFileSync(f.source), original);
  });
});

test("source changes and corrupted destination bytes cannot produce a ready copy", async () => {
  for (const changed of ["source", "destination"]) await fixture(async (f) => {
    const original = readFileSync(f.source);
    f.state.hook = (phase) => { if (phase === "after-copy") writeFileSync(changed === "source" ? f.source : f.path(operation, "source.partial"), original.subarray(0, original.length - 1)); };
    await assert.rejects(prepareLegacyInspectionCopy(f.files, operation), { message: "SOURCE_COPY_CHANGED" });
    assert.equal(existsSync(f.path(operation, "receipt.json")), false); assert.equal(f.opened.length, 0);
    if (changed === "destination") assert.deepEqual(readFileSync(f.source), original);
  });
});

test("non-SQLite files and partial sidecars fail before any SQLite open", async () => {
  for (const kind of ["json", "tiny", "sidecar"]) await fixture(async (f) => {
    if (kind === "json") writeFileSync(f.source, JSON.stringify({ data: "x".repeat(200) }));
    if (kind === "tiny") writeFileSync(f.source, "short");
    const original = readFileSync(f.source);
    if (kind === "sidecar") f.state.hook = (phase) => { if (phase === "after-copy") writeFileSync(f.path(operation, "source.partial-wal"), ""); };
    await assert.rejects(prepareLegacyInspectionCopy(f.files, operation), { message: "SOURCE_COPY_INVALID" });
    assert.equal(f.opened.length, 0); assert.deepEqual(readFileSync(f.source), original);
  });
});

test("file-publish and receipt-write interruptions remain unreadable until the receipt is published", async () => {
  for (const phase of ["after-file-publish", "after-receipt-write", "after-receipt-publish"]) await fixture(async (f) => {
    const expected = parseInspectionReceipt({ kind: "athlete-diary-source-copy", version: 1, operationId: operation, ...digest(f.source) });
    f.state.hook = (current) => { if (current === phase) throw new Error("simulated process interruption"); };
    await assert.rejects(prepareLegacyInspectionCopy(f.files, operation), { message: "SOURCE_COPY_IO_FAILED" }); f.state.hook = null;
    if (phase === "after-receipt-publish") {
      unlinkSync(f.source); // Simulate losing access to this synthetic picker file after a completed copy.
      assert.equal((await readLegacyInspectionCopy(f.files, expected)).snapshots.measurements.clientDays!.length, 1);
    } else {
      await assert.rejects(readLegacyInspectionCopy(f.files, expected), { message: "SOURCE_COPY_INVALID" }); assert.equal(f.opened.length, 0);
    }
  });
});

test("receipt drift, sidecars and changes during SQLite reading invalidate the result", async () => {
  for (const kind of ["receipt", "sidecar", "during-read"]) await fixture(async (f) => {
    const original = readFileSync(f.source), receipt = await prepareLegacyInspectionCopy(f.files, operation);
    if (kind === "receipt") writeFileSync(f.path(operation, "receipt.json"), JSON.stringify({ ...receipt, sha256: "b".repeat(64) }));
    if (kind === "sidecar") writeFileSync(f.path(operation, "source.sqlite-shm"), "");
    if (kind === "during-read") f.state.hook = (phase) => { if (phase === "after-sqlite-close") { const db = new DatabaseSync(f.path(operation, "source.sqlite")); db.exec("UPDATE client_day_facts SET weight='99'"); db.close(); } };
    await assert.rejects(readLegacyInspectionCopy(f.files, receipt), { message: kind === "sidecar" ? "SOURCE_COPY_INVALID" : "SOURCE_COPY_CHANGED" });
    assert.equal(f.opened.length, kind === "during-read" ? 1 : 0); assert.deepEqual(readFileSync(f.source), original);
  });
});

test("actual Expo file driver awaits asynchronous copy and rename before opening only its private copy", () => fixture(async (f) => {
  const worker = `import{parentPort,workerData}from'node:worker_threads';import{registerHooks}from'node:module';
    globalThis.inspectionRoot=workerData.root;globalThis.inspectionCalls=[];
    registerHooks({resolve(specifier,context,next){if(['expo-file-system','expo-file-system/legacy','expo-sqlite','react-native'].includes(specifier))return{url:workerData.mock,shortCircuit:true};return next(specifier,context);}});
    const {File}=await import('expo-file-system');const{ExpoLegacyInspectionFiles}=await import(workerData.driver);
    const{prepareLegacyInspectionCopy,readLegacyInspectionCopy}=await import(workerData.protocol);
    const files=new ExpoLegacyInspectionFiles(new File(workerData.source));const receipt=await prepareLegacyInspectionCopy(files,workerData.operation);
    const result=await readLegacyInspectionCopy(new ExpoLegacyInspectionFiles(),receipt);
    parentPort.postMessage({result,calls:globalThis.inspectionCalls});`;
  const actual = await new Promise<{ result: Awaited<ReturnType<typeof readLegacyInspectionCopy>>; calls: { phase: string; file?: string; to?: string }[] }>((resolveWorker, reject) => {
    const task = new Worker(new URL(`data:text/javascript,${encodeURIComponent(worker)}`), { execArgv: ["--experimental-strip-types"], workerData: {
      root: join(f.dir, "mock-app-documents"), source: f.source, operation, scope,
      mock: `data:text/javascript,${encodeURIComponent(inspectionExpoMock)}`,
      driver: new URL("../apps/mobile/src/features/legacy-import/data/ExpoLegacyInspectionFiles.ts", import.meta.url).href,
      protocol: new URL("../apps/mobile/src/features/legacy-import/data/LegacyInspectionCopy.ts", import.meta.url).href,
    } });
    let received: { result: Awaited<ReturnType<typeof readLegacyInspectionCopy>>; calls: { phase: string; file?: string; to?: string }[] } | null = null;
    task.once("message", (value) => { received = value as typeof received; }); task.once("error", reject);
    task.once("exit", (code) => { if (code || received === null) reject(new Error(`EXPO_INSPECTION_FIXTURE_EXIT_${code}`)); else resolveWorker(received); });
  });
  assert.deepEqual(actual.calls.map(({ phase }) => phase), ["copy-start", "copy-finish", "rename-start", "rename-finish", "rename-start", "rename-finish", "sqlite"]);
  const privateFile = join(f.dir, "mock-app-documents", "legacy-source-copies", operation, "source.sqlite");
  assert.equal(actual.calls.at(-1)!.file, privateFile); assert.notEqual(privateFile, f.source);
  assert.equal(actual.result.snapshots.measurements.clientDays![0]!.weight, "80.1");
  assert.deepEqual(actual.result.snapshots.plans.tables.training_programs, []);
  assert.deepEqual(actual.result.snapshots.executions.tables.training_exercise_history, []);
  assert.deepEqual({ sha256: actual.result.receipt.sha256, bytes: actual.result.receipt.bytes }, digest(f.source));
}));
