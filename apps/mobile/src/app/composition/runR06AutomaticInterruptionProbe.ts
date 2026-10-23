import { Directory, File, Paths } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import { uuid, requireOptionalNativeModule } from "expo-modules-core";
import * as SQLite from "expo-sqlite";
import { AutomaticBackupService, parseAutomaticCatalog, parseAutomaticPublication,
  type AutomaticBackupFiles, type AutomaticBackupStore, type AutomaticCatalog } from "../../features/backup/public.ts";
import { ExpoAutomaticBackupFiles } from "../../features/backup/data/ExpoAutomaticBackupFiles.ts";
import { expoAutomaticBackupStore } from "../../features/backup/data/ExpoAutomaticBackupStore.ts";
import { ExpoSqliteBackup } from "../../features/backup/data/ExpoSqliteBackup.ts";
import { SharedSqliteDatabase } from "../../shared/db/SharedSqliteDatabase.ts";
import { openIsolatedSqliteConnection } from "../../shared/db/IsolatedSqliteConnection.ts";
import { RuntimeCommandGate } from "../runtime/RuntimeCommandGate.ts";
import { createLocalRepositories } from "./createLocalRepositories.ts";
import { prepareProductionDatabase, inspectProductionDatabase, PRODUCTION_IDENTITY, PRODUCTION_WORKSPACE_ID } from "./productionDatabase.ts";
import { SCHEMA_OWNERS } from "./schema.ts";
import systemCatalog from "../../features/exercises/data/system-catalog.generated.json";
import type { SystemCatalog } from "../../features/exercises/public.ts";
import type { R06NativeReport } from "./runR06NativeProbe.ts";

type Mode = "ARM_RECEIPT" | "RECOVER_RECEIPT" | "ARM_CATALOG" | "RECOVER_CATALOG";
type Phase = "BASELINE" | "RECEIPT_ARMED" | "RECEIPT_RECOVERED" | "CATALOG_ARMED" | "COMPLETE";
interface Fixture {
  readonly version: 1; readonly token: string; readonly time: number; readonly ids: readonly string[];
  readonly phase: Phase; readonly prior: AutomaticCatalog | null; readonly target: string | null;
}
interface Native {
  createAutomaticFixture(): Promise<string>;
  armAutomaticFixtureReceipt(token: string, id: string): Promise<boolean>;
  disarmAutomaticFixtureReceipt(token: string, id: string): Promise<boolean>;
  automaticFixturePublication(token: string, id: string): Promise<{ uri: string; pending: boolean }>;
  publishAutomaticFixture(source: string, id: string, created: string, sha: string, size: number, token: string): Promise<unknown>;
}
const ownedId = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const owner = (id: string) => JSON.stringify({ kind: "r06-auto-interruption", version: 1, id });
function object(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== keys) throw new Error("R06_AUTO_KILL_INVALID_FIXTURE");
  return value as Record<string, unknown>;
}
function parseFixture(value: unknown): Fixture {
  const f = object(value, "ids,phase,prior,target,time,token,version");
  if (f.version !== 1 || typeof f.token !== "string" || !ownedId.test(f.token) || typeof f.time !== "number" || !Number.isSafeInteger(f.time) ||
    !Array.isArray(f.ids) || f.ids.length > 5 || f.ids.some((id: unknown) => typeof id !== "string" || !ownedId.test(id)) ||
    !["BASELINE", "RECEIPT_ARMED", "RECEIPT_RECOVERED", "CATALOG_ARMED", "COMPLETE"].includes(f.phase as string) ||
    (f.target !== null && (typeof f.target !== "string" || !ownedId.test(f.target)))) throw new Error("R06_AUTO_KILL_INVALID_FIXTURE");
  return { version: 1, token: f.token, time: f.time, ids: f.ids as string[], phase: f.phase as Phase,
    target: f.target as string | null, prior: f.prior === null ? null : parseAutomaticCatalog(f.prior) };
}
async function writePrivate(file: File, value: unknown): Promise<void> {
  const json = JSON.stringify(value); const next = new File(`${file.uri}.next`);
  next.write(json); if (await next.text() !== json) throw new Error("R06_AUTO_KILL_FIXTURE_IO");
  await moveAsync({ from: next.uri, to: file.uri });
  if (await file.text() !== json) throw new Error("R06_AUTO_KILL_FIXTURE_IO");
}
/** Explicitly armed debug-only process-death rehearsal. No personal inputs, auto run on
 * launch or production fault switches. ARM modes wait until the test PID is killed. */
export async function runR06AutomaticInterruptionProbe(mode: Mode): Promise<R06NativeReport> {
  const started = Date.now(); const checks: { name: string; passed: boolean }[] = [];
  const check = (name: string, passed: boolean) => {
    checks.push({ name, passed }); console.info(`R06_AUTO_KILL_CHECK ${name} ${passed ? "PASS" : "FAIL"}`);
    if (!passed) throw new Error("R06_AUTO_KILL_CHECK_FAILED");
  };
  const parent = new Directory(Paths.document, "r06-auto-interruption"); parent.create({ intermediates: true, idempotent: true });
  const pointer = new File(parent, "current.json"); const native = requireOptionalNativeModule<Native>("AthleteBackupStorage");
  if (!native) throw new Error("R06_AUTO_KILL_NATIVE_UNAVAILABLE");
  let root: Directory; let fixture: Fixture;
  if (mode === "ARM_RECEIPT") {
    const id = uuid.v4(); root = new Directory(parent, id); root.create(); new File(root, "owner.json").write(owner(id));
    const token = await native.createAutomaticFixture(); fixture = { version: 1, token, time: Date.parse("2002-01-01T10:00:00.000Z"), ids: [], phase: "BASELINE", prior: null, target: null };
    await writePrivate(pointer, { version: 1, id });
  } else {
    const p = object(JSON.parse(await pointer.text()) as unknown, "id,version");
    if (p.version !== 1 || typeof p.id !== "string" || !ownedId.test(p.id)) throw new Error("R06_AUTO_KILL_INVALID_POINTER");
    root = new Directory(parent, p.id);
    if (await new File(root, "owner.json").text() !== owner(p.id)) throw new Error("R06_AUTO_KILL_INVALID_OWNER");
    fixture = parseFixture(JSON.parse(await new File(root, "fixture.json").text()) as unknown);
  }
  const fixtureFile = new File(root, "fixture.json"); const save = async (f: Fixture) => { fixture = parseFixture(f); await writePrivate(fixtureFile, fixture); };
  const images = new Directory(root, "images"); images.create({ idempotent: true }); const live = new File(root, "live.db");
  const schema = { identity: PRODUCTION_IDENTITY, owners: SCHEMA_OWNERS };
  const database = new SharedSqliteDatabase(() => openIsolatedSqliteConnection(() => SQLite.openDatabaseAsync(live.name,
    { useNewConnection: true }, root.uri), inspectProductionDatabase));
  const owners = createLocalRepositories(database, PRODUCTION_WORKSPACE_ID, systemCatalog as SystemCatalog);
  const commands = new RuntimeCommandGate(); const clients = commands.port(owners.clients);
  const store = expoAutomaticBackupStore(new Directory(root, "state"));
  const files = new ExpoAutomaticBackupFiles({ root: new Directory(root, "state"), live, images, schema,
    pendingIds: () => store.protectedJobIds(), now: () => fixture.time });
  check("native_auto_kill_capability", files.available);
  let armNative = false; let armCatalog = false; let prepares = 0; let publications = 0;
  const observed: AutomaticBackupFiles = { available: files.available,
    prepare: (previous) => { prepares++; return files.prepare(previous); },
    publish: async (p) => {
      publications++;
      if (armNative) {
        await save({ ...fixture, phase: "RECEIPT_ARMED", target: p.backupId });
        if (!await native.armAutomaticFixtureReceipt(fixture.token, p.backupId)) throw new Error("R06_AUTO_KILL_NOT_ARMED");
      }
      const raw = await native.publishAutomaticFixture(new File(root, "state", "automatic-jobs", p.backupId, "snapshot.atbackup").uri,
        p.backupId, p.createdAt, p.sha256, p.bytes, fixture.token);
      if (!raw || typeof raw !== "object" || !("ok" in raw) || raw.ok !== true) throw new Error("R06_AUTO_KILL_PUBLICATION_FAILED");
      const r = raw as Record<string, unknown>;
      return parseAutomaticPublication({ uri: r.uri, filename: r.filename, sha256: r.sha256, bytes: r.bytes }, p);
    }, inspect: (e) => files.inspect(e), verify: (e) => files.verify(e), remove: (e) => files.remove(e), cleanup: (id) => files.cleanup(id) };
  const observedStore: AutomaticBackupStore = { ...store, write: async (c) => {
    await store.write(c);
    if (armCatalog && c.pending === null && c.entries[0]?.backupId !== fixture.prior?.entries[0]?.backupId && c.retired.length > 0) {
      check("native_auto_kill_committed_catalog_readback", JSON.stringify(await store.read()) === JSON.stringify(c));
      await save({ ...fixture, phase: "CATALOG_ARMED", target: c.entries[0]!.backupId });
      console.info("R06_AUTO_KILL_READY CATALOG_COMMITTED_BEFORE_CLEANUP");
      await new Promise<void>(() => { /* External orchestrator kills only this test PID. */ });
    }
  } };
  const service = new AutomaticBackupService({ enabled: true, files: observed, store: observedStore, now: () => fixture.time, offset: () => 0,
    ready: () => true, location: async () => ({ kind: "DOWNLOADS" }), run: (task) => commands.run(task) });
  try {
    if (mode === "ARM_RECEIPT") await prepareProductionDatabase(database);
    await owners.initialize();
    if (mode === "ARM_RECEIPT") {
      const first = await clients.create({ displayName: "R06 SYNTHETIC KILL BASELINE" }); await save({ ...fixture, ids: [first.id] });
      await service.retry(); check("native_auto_kill_baseline_verified", service.state.error === null && (await store.read())!.entries.length === 1);
      const second = await clients.create({ displayName: "R06 SYNTHETIC KILL PENDING" });
      await save({ ...fixture, ids: [...fixture.ids, second.id], time: fixture.time + 30 * 60 * 1000, prior: await store.read() });
      armNative = true; await service.retry(); throw new Error("R06_AUTO_KILL_RECEIPT_DID_NOT_WAIT");
    }
    if (mode === "ARM_CATALOG") {
      if (fixture.phase !== "RECEIPT_RECOVERED") throw new Error("R06_AUTO_KILL_WRONG_PHASE");
      const third = await clients.create({ displayName: "R06 SYNTHETIC KILL COMMITTED" });
      await save({ ...fixture, ids: [...fixture.ids, third.id], time: fixture.time + 30 * 60 * 1000, prior: await store.read(), target: null });
      armCatalog = true; await service.retry(); throw new Error("R06_AUTO_KILL_CATALOG_DID_NOT_WAIT");
    }
    const receiptRecovery = mode === "RECOVER_RECEIPT";
    check("native_auto_kill_matching_fixture_phase", fixture.phase === (receiptRecovery ? "RECEIPT_ARMED" : "CATALOG_ARMED") && fixture.target !== null && fixture.prior !== null);
    const before = (await store.read())!; const target = fixture.target!; const previous = fixture.prior!.entries[0]!;
    const publication = await native.automaticFixturePublication(fixture.token, target);
    check("native_auto_kill_previous_file_still_valid", await files.inspect(previous) === "VALID");
    if (receiptRecovery) {
      check("native_auto_kill_pending_plan_survived", before.pending?.backupId === target && before.entries[0]!.backupId === previous.backupId && before.retired.length === 0);
      check("native_auto_kill_native_receipt_precedes_visibility", publication.pending === true);
      check("native_auto_kill_disarm_after_new_process", await native.disarmAutomaticFixtureReceipt(fixture.token, target));
    } else {
      check("native_auto_kill_committed_plan_survived", before.pending === null && before.entries[0]!.backupId === target && before.retired[0]!.backupId === previous.backupId);
      check("native_auto_kill_committed_file_already_visible", publication.pending === false);
    }
    await service.check(); const after = (await store.read())!;
    check("native_auto_kill_recovery_completed", service.state.error === null && after.pending === null && after.retired.length === 0 && after.entries.length === 1);
    check("native_auto_kill_same_exact_native_uri", after.entries[0]!.backupId === target && after.entries[0]!.uri === publication.uri);
    check("native_auto_kill_recovery_did_not_prepare_another_snapshot", prepares === 0 && publications === (receiptRecovery ? 1 : 0));
    check("native_auto_kill_recovered_file_visible_and_exact", (await native.automaticFixturePublication(fixture.token, target)).pending === false && await files.inspect(after.entries[0]!) === "VALID");
    check("native_auto_kill_old_file_retired_only_after_commit", await files.inspect(previous) === "MISSING");
    await service.retry();
    check("native_auto_kill_repeat_has_no_duplicate", service.state.error === null && (await store.read())!.sequence === after.sequence && publications === (receiptRecovery ? 1 : 0));
    check("native_auto_kill_private_source_cleaned", !new Directory(root, "state", "automatic-jobs", target).exists);
    const copy = new File(root, receiptRecovery ? "receipt-verified.atbackup" : "catalog-verified.atbackup");
    await new ExpoSqliteBackup(schema).validateExternal(new File(publication.uri), copy);
    const read = await SQLite.openDatabaseAsync(copy.name, { useNewConnection: true }, root.uri);
    try {
      const rows = await read.getAllAsync<{ id: string }>("SELECT id FROM clients");
      check("native_auto_kill_snapshot_preserves_all_client_facts", rows.length === fixture.ids.length && fixture.ids.every((id) => rows.some((r) => r.id === id)));
    } finally { await read.closeAsync(); }
    const later = await clients.create({ displayName: `R06 SYNTHETIC KILL LATER ${mode}` });
    check("native_auto_kill_all_holders_and_late_write_usable", owners.ownerCount === 15 && await clients.get(later.id) !== null);
    // This later fact belongs to LIVE only; the next phase must include it as well.
    await save({ ...fixture, ids: [...fixture.ids, later.id], phase: receiptRecovery ? "RECEIPT_RECOVERED" : "COMPLETE" });
    return { kind: "R06_NATIVE", checks, allPassed: checks.every((c) => c.passed), elapsedMs: Date.now() - started };
  } finally { await owners.close(); }
}
