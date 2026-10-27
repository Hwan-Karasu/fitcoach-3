import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { BootCoordinator } from "../src/app/bootstrap/BootCoordinator.ts";
import { useMaintenanceView } from "../src/app/bootstrap/useMaintenanceView.ts";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { RuntimeCommandGate, RuntimeBusyError } from "../src/app/runtime/RuntimeCommandGate.ts";
import { RuntimeMaintenance } from "../src/app/runtime/RuntimeMaintenance.ts";
import { WorkflowDatabaseLease } from "../src/app/runtime/WorkflowDatabaseLease.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { createLocalRepositories } from "../src/app/composition/createLocalRepositories.ts";
import { prepareProductionDatabase, PRODUCTION_WORKSPACE_ID as WS } from "../src/app/composition/productionDatabase.ts";
import type { SystemCatalog } from "../src/features/exercises/domain/ExerciseModel.ts";
import { createClientCardWorkflow } from "../src/workflows/saveClientCard.ts";
import { createTrainingHistory } from "../src/read-models/trainingHistory.ts";
import { GuardedRestore } from "../src/features/backup/application/GuardedRestore.ts";
import { HostRestoreStorage } from "../../../scripts/r06/HostRestoreStorage.ts";
import { createSqliteBackup, prepareBackupForRestore } from "../../../scripts/r06/SqliteBackup.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

function latch() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const catalog = JSON.parse(readFileSync(new URL("../src/features/exercises/data/system-catalog.generated.json", import.meta.url), "utf8")) as SystemCatalog;
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("startup journal checks keep the home route; later user restoration returns to backups", async () => {
  const f = await fixture();
  const boot = new BootCoordinator({ fallbackThemeId: "night-mocha",
    recoverBeforeOpen: async () => { f.cold(); await f.maintenance.withClosedDatabase(async () => undefined); },
    prepareWorkspace: async () => ({ id: WS }), openDatabase: async () => { await f.owners.initialize(); },
    loadThemePreference: async () => ({ themeId: "slate-blue", accentId: "violet" }),
  });
  let view!: ReturnType<typeof useMaintenanceView>;
  function Probe() { view = useMaintenanceView(boot, f.maintenance); return null; }
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = TestRenderer.create(createElement(Probe)); });
    assert.equal(view.initialBackup, false);
    // APP_READY is published before React flushes the queued maintenance updates.
    await act(async () => { await boot.start(); });
    assert.equal(boot.state.kind, "APP_READY");
    assert.equal(view.phase, "ACTIVE");
    assert.equal(view.generation, 1, "startup still invalidates old repository views");
    assert.equal(view.initialBackup, false, "a completed journal check must open home");
    await act(async () => { await f.maintenance.withClosedDatabase(async () => undefined); });
    assert.equal(view.phase, "ACTIVE");
    assert.equal(view.generation, 2);
    assert.equal(view.initialBackup, true, "an operation started in the app returns to backups");
    await act(async () => { renderer!.unmount(); renderer = TestRenderer.create(createElement(Probe)); });
    assert.equal(view.initialBackup, false, "a fresh launch does not retain the backup route");
  } finally {
    await act(async () => { renderer?.unmount(); });
    await f.close();
  }
});

async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "athlete-runtime-"));
  const file = join(directory, "live.db"); let liveHandles = 0; let peakHandles = 0; let failOpen = false;
  const database = new SharedSqliteDatabase(async () => {
    if (failOpen) throw new Error("PRIVATE_OPEN_FAILURE");
    const port = nodeSqlitePort(new DatabaseSync(file));
    liveHandles++; peakHandles = Math.max(peakHandles, liveHandles);
    return { ...port, async close() { await port.close(); liveHandles--; } };
  });
  await prepareProductionDatabase(database);
  const owners = createLocalRepositories(database, WS, catalog); await owners.initialize();
  const workflow = new WorkflowDatabaseLease(database); const commands = new RuntimeCommandGate();
  const card = commands.port(createClientCardWorkflow((task) => workflow.write(task), owners.clients.cardParticipant, owners.questionnaire.answersParticipant));
  let invalidated = 0; let cold = false; let failReopen = false; let reopenGate: Promise<void> | null = null;
  const maintenance = new RuntimeMaintenance({ database, commands, drainBackground: async () => undefined,
    closeOwners: async () => { await owners.close(); await workflow.close(); },
    shouldReopen: () => !cold,
    reopen: async () => { if (failReopen) throw new Error("PRIVATE_REOPEN_FAILURE"); await owners.initialize(); await reopenGate; workflow.resume(); },
    invalidate: () => { invalidated++; } });
  return { directory, file, database, owners, workflow, commands, card, maintenance,
    get liveHandles() { return liveHandles; }, get peakHandles() { return peakHandles; }, get invalidated() { return invalidated; },
    cold: () => { cold = true; }, failOpen: (value: boolean) => { failOpen = value; }, failReopen: (value: boolean) => { failReopen = value; },
    waitReopen: (gate: Promise<void>) => { reopenGate = gate; },
    async close() { await owners.close(); await workflow.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test("startup recovery failure stays blocked; successful retry opens home instead of backups", async () => {
  const f = await fixture();
  let fail = true;
  const boot = new BootCoordinator({ fallbackThemeId: "night-mocha",
    recoverBeforeOpen: async () => {
      f.cold();
      await f.maintenance.withClosedDatabase(async () => { if (fail) throw new Error("SYNTHETIC_RECOVERY_FAILURE"); });
    },
    prepareWorkspace: async () => ({ id: WS }), openDatabase: async () => { await f.owners.initialize(); },
    loadThemePreference: async () => ({ themeId: "slate-blue", accentId: "violet" }),
  });
  let view!: ReturnType<typeof useMaintenanceView>;
  function Probe() { view = useMaintenanceView(boot, f.maintenance); return null; }
  let renderer: TestRenderer.ReactTestRenderer | undefined;
  try {
    await act(async () => { renderer = TestRenderer.create(createElement(Probe)); });
    await act(async () => { await boot.start(); });
    assert.equal(boot.state.kind, "BOOT_FAILED");
    assert.equal(view.phase, "RECOVERY_REQUIRED");
    assert.equal(view.initialBackup, false);
    fail = false;
    await act(async () => {
      await f.maintenance.withClosedDatabase(async () => undefined);
      await boot.retry();
    });
    assert.equal(boot.state.kind, "APP_READY");
    assert.equal(view.phase, "ACTIVE");
    assert.equal(view.initialBackup, false);
  } finally {
    await act(async () => { renderer?.unmount(); });
    await f.close();
  }
});

test("R06 runtime drains an admitted multi-await operation before owner close; new calls reject as Promises", async () => {
  const f = await fixture(); const read = latch(); const fileTask = latch(); const reopening = latch();
  f.waitReopen(reopening.promise);
  const events: string[] = []; const states: string[] = [];
  const off = f.maintenance.subscribe((state) => states.push(state));
  try {
    const running = f.commands.run(async () => { events.push("read"); await read.promise;
      await f.workflow.write(async (tx) => { await tx.run("UPDATE workspaces SET display_name='SYNTHETIC DRAINED' WHERE id=?", [WS]); });
      events.push("committed"); });
    await tick();
    const maintenance = f.maintenance.withClosedDatabase(async () => {
      assert.equal(f.liveHandles, 0); events.push("file"); await fileTask.promise; return 42;
    });
    const denied = f.commands.port(f.owners.clients).get("never");
    assert.ok(denied instanceof Promise); await assert.rejects(denied, RuntimeBusyError);
    await assert.rejects(f.maintenance.withClosedDatabase(async () => undefined), RuntimeBusyError);
    await tick(); assert.deepEqual(events, ["read"]);
    read.release(); await running; await tick();
    assert.deepEqual(events, ["read", "committed", "file"]);
    fileTask.release(); await tick();
    assert.equal(f.maintenance.state, "REOPENING"); assert.equal(f.invalidated, 0);
    await assert.rejects(f.commands.run(async () => 8), RuntimeBusyError);
    reopening.release(); assert.equal(await maintenance, 42);
    assert.equal(f.liveHandles, 1); assert.equal(f.peakHandles, 1); assert.equal(f.invalidated, 1);
    assert.deepEqual(states, ["ACTIVE", "DRAINING", "CLOSED", "REOPENING", "ACTIVE"]);
    assert.equal(await f.commands.run(async () => 7), 7);
  } finally { read.release(); fileTask.release(); reopening.release(); off(); await f.close(); }
});

test("R06 all 15 actual repositories plus workflow holder close for backup→guarded replace→reopen", async () => {
  const f = await fixture();
  try {
    assert.equal(f.owners.ownerCount, 15);
    const historic = await f.card.save(null, { displayName: "SYNTHETIC HISTORIC" }, {});
    const source = new DatabaseSync(f.file, { readOnly: true }); const backup = join(f.directory, "copy.atbackup");
    try { await createSqliteBackup(source, join(f.directory, "copy.partial"), backup,
      { backupId: "10000000-0000-4000-8000-000000000001", createdAt: "2026-10-23T12:00:00.000Z" }); }
    finally { source.close(); }
    const newer = await f.card.save(null, { displayName: "SYNTHETIC NEWER" }, {});
    const storage = new HostRestoreStorage(f.directory);
    await prepareBackupForRestore(backup, storage.path("INCOMING"));
    const currentHash = hash(f.file); const incomingHash = hash(storage.path("INCOMING"));
    const hostGate = storage.withClosedDatabase.bind(storage);
    storage.withClosedDatabase = (task) => f.maintenance.withClosedDatabase(async () => {
      assert.equal(f.liveHandles, 0, "all application holders released before any file operation"); return hostGate(task);
    });
    assert.equal(await new GuardedRestore(storage).restore({ operationId: "runtime-all-owners", currentSha256: currentHash, incomingSha256: incomingHash }), "COMMITTED");
    assert.equal((await f.owners.clients.get(historic.client.id))?.displayName, "SYNTHETIC HISTORIC");
    assert.equal(await f.owners.clients.get(newer.client.id), null);
    assert.equal(hash(storage.path("SAFETY")), currentHash);
    assert.ok((await f.card.save(null, { displayName: "SYNTHETIC AFTER REOPEN" }, {})).client.id);
    assert.equal(f.peakHandles, 1); assert.equal(f.invalidated, 1);
  } finally { await f.close(); }
});

for (const point of ["file", "reopen"] as const) test(`R06 ${point} failure keeps runtime commands closed until recovery and successful reopen`, async () => {
  const f = await fixture();
  try {
    if (point === "reopen") f.failReopen(true);
    await assert.rejects(f.maintenance.withClosedDatabase(async () => { if (point === "file") throw new Error("PRIVATE_PATH_FAILURE"); }), /RUNTIME_RECOVERY_REQUIRED/u);
    assert.equal(f.maintenance.state, "RECOVERY_REQUIRED");
    await assert.rejects(f.commands.run(async () => true), RuntimeBusyError);
    f.failReopen(false);
    await f.maintenance.withClosedDatabase(async () => undefined);
    assert.equal(f.maintenance.state, "ACTIVE"); assert.equal(f.liveHandles, 1);
    assert.equal(await f.commands.run(async () => "ready"), "ready");
  } finally { await f.close(); }
});

test("R06 cold recovery closes owners but leaves schema/repository initialization to normal boot", async () => {
  const f = await fixture(); f.cold();
  try {
    await f.maintenance.withClosedDatabase(async () => { assert.equal(f.liveHandles, 0); });
    assert.equal(f.liveHandles, 0); assert.equal(f.maintenance.state, "ACTIVE");
  } finally { await f.close(); }
});

test("R06 workflow failed acquire is not cached; close drains and releases its real holder exactly once", async () => {
  const f = await fixture();
  try {
    await f.owners.close(); f.failOpen(true);
    await assert.rejects(f.workflow.write(async () => 1), /PRIVATE_OPEN_FAILURE/u);
    f.failOpen(false); assert.equal(await f.workflow.write(async () => 2), 2);
    const close = f.workflow.close(); assert.strictEqual(f.workflow.close(), close); await close;
    assert.equal(f.liveHandles, 0);
    await assert.rejects(f.workflow.write(async () => 3), /WORKFLOW_MAINTENANCE/u);
    f.workflow.resume(); assert.equal(await f.workflow.write(async () => 4), 4);
  } finally { await f.close(); }
});

test("R06 command facade preserves synchronous subscriptions/meta/list and bound method identity", async () => {
  const gate = new RuntimeCommandGate(); let unsubscriptions = 0;
  const raw = { value: 7, async get() { return this.value; }, meta() { return this.value; }, list() { return [this.value]; },
    subscribe() { return () => { unsubscriptions++; }; },
    subscribeSavedMealChanges() { return () => { unsubscriptions++; }; } };
  const port = gate.port(raw, ["meta", "list"]);
  assert.strictEqual(port.get, port.get); assert.equal(await port.get(), 7);
  gate.pause(); assert.equal(port.meta(), 7); assert.deepEqual(port.list(), [7]);
  const off = port.subscribe(); off(); assert.equal(unsubscriptions, 1);
  const offMeals = port.subscribeSavedMealChanges();
  assert.equal(typeof offMeals, "function", "saved-meal screen cleanup must not receive a Promise");
  offMeals(); assert.equal(unsubscriptions, 2);
  await assert.rejects(port.get(), RuntimeBusyError);
});

test("R06 explicit runtime invalidation clears cached training history without fake domain commits", async () => {
  let queries = 0; let invalidate: (() => void) | undefined;
  const history = createTrainingHistory({ hasEnteredData: () => false, isWorkingSet: () => false,
    sessionDurationSec: () => null, workoutStatus: () => "NOT_STARTED", sortHistory: (entries) => entries },
  { listClientExecutions: async () => { queries++; return []; }, subscribeCommittedChanges: () => () => undefined },
  { getLibrary: async () => ({ clientId: "synthetic", active: [], archived: [], selectedProgramId: null }), getPeriodizedPlan: async () => null,
    getSimpleWeeks: async () => [], subscribeCommittedChanges: () => () => undefined }, (reset) => { invalidate = reset; });
  await history.list("synthetic"); await history.list("synthetic"); assert.equal(queries, 1);
  assert.ok(invalidate); invalidate(); await history.list("synthetic"); assert.equal(queries, 2);
});
