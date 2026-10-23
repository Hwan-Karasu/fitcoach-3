import assert from "node:assert/strict";
import test from "node:test";
import { AutomaticBackupService, AutomaticBackupError, AUTO_BACKUP_INTERVAL, automaticFilename, parseAutomaticCatalog,
  type AutomaticBackupFiles, type AutomaticBackupStore, type AutomaticCatalog, type PendingAutomatic, type AutomaticFailure,
  type BackupDestination, type PublishedBackup } from "../src/features/backup/public.ts";
import { RuntimeCommandGate } from "../src/app/runtime/RuntimeCommandGate.ts";

const monday = Date.parse("2026-10-19T10:00:00.000Z");
const copy = <T>(value: T): T => structuredClone(value);
function world() {
  let time = monday; let zone = 0; let data = 1; let number = 0;
  let catalog: AutomaticCatalog | null = null; let destination: BackupDestination = { kind: "DOWNLOADS" };
  let failure: AutomaticFailure | null = null;
  const archives: AutomaticCatalog[] = []; const events: string[] = []; const prepared = new Map<string, PendingAutomatic>();
  const external = new Map<string, PublishedBackup>(); const removed = new Set<string>(); const commands = new RuntimeCommandGate();
  const faults = { prepare: false, publish: false, verify: false, remove: false, beforeCommit: false, afterCommit: false };
  const store: AutomaticBackupStore = {
    readFailure: async () => copy(failure), writeFailure: async (value) => { failure = copy(value); },
    read: async () => catalog === null ? null : parseAutomaticCatalog(copy(catalog)),
    archive: async (value) => { archives.push(copy(value)); },
    write: async (value) => {
      const checked = parseAutomaticCatalog(copy(value));
      const commit = checked.pending === null && checked.entries[0]?.backupId !== catalog?.entries[0]?.backupId;
      if (commit && faults.beforeCommit) throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE");
      catalog = checked; events.push(`state:${catalog.entries[0]?.backupId ?? "none"}:${catalog.pending?.backupId ?? "none"}`);
      if (commit && faults.afterCommit) throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE");
    },
  };
  const files: AutomaticBackupFiles = {
    available: true,
    prepare: async (previous) => {
      events.push("prepare"); if (faults.prepare) throw new AutomaticBackupError("AUTO_SOURCE_UNAVAILABLE");
      if (previous === data.toString(16).padStart(64, "0")) return null;
      const id = `10000000-0000-4000-8000-${(++number).toString().padStart(12, "0")}`;
      const p = { backupId: id, createdAt: new Date(time).toISOString(), contentSha256: data.toString(16).padStart(64, "0"), sha256: number.toString(16).padStart(64, "0"), bytes: 4096 };
      prepared.set(id, p); return p;
    },
    publish: async (p) => {
      assert.equal(catalog?.pending?.backupId, p.backupId, "the complete pending plan must be durable before external publication");
      events.push(`publish:${p.backupId}`); if (faults.publish) throw new AutomaticBackupError("AUTO_FOLDER_UNAVAILABLE");
      if (!external.has(p.backupId)) external.set(p.backupId, { uri: `content://synthetic/${p.backupId}`, filename: automaticFilename(p), bytes: p.bytes, sha256: p.sha256 });
      return copy(external.get(p.backupId)!);
    },
    inspect: async (entry) => {
      if (faults.verify) throw new AutomaticBackupError("AUTO_VERIFICATION_FAILED");
      return external.has(entry.backupId) ? "VALID" : "MISSING";
    },
    verify: async (entry) => {
      if (faults.verify || !external.has(entry.backupId)) throw new AutomaticBackupError("AUTO_VERIFICATION_FAILED");
    },
    remove: async (entry) => {
      assert.ok(catalog?.retired.some((e) => e.backupId === entry.backupId));
      assert.ok(!catalog?.entries.some((e) => e.backupId === entry.backupId));
      assert.ok(catalog!.entries.every((e) => external.has(e.backupId)), "new managed trio exists before deleting any old file");
      events.push(`remove:${entry.backupId}`); if (faults.remove) throw new Error("permission lost");
      removed.add(entry.backupId); external.delete(entry.backupId);
    },
    cleanup: async (id) => { prepared.delete(id); events.push(`cleanup:${id}`); },
  };
  const make = (enabled = true) => new AutomaticBackupService({ enabled, files, store, location: async () => copy(destination),
    now: () => time, offset: () => zone, ready: () => true, run: (task) => commands.run(task) });
  const service = make();
  return { service, make, files, store, faults, events, external, prepared, removed, archives, commands,
    get catalog() { return catalog; }, setCatalog: (c: AutomaticCatalog) => { catalog = copy(c); },
    setTime: (n: number) => { time = n; }, setZone: (n: number) => { zone = n; }, change: () => { data++; },
    location: (d: BackupDestination) => { destination = d; }, get prepares() { return events.filter((e) => e === "prepare").length; } };
}

test("R06 auto first check schedules 30 minutes; unchanged data never creates a duplicate even on another day", async () => {
  const w = world(); await w.service.check(); assert.equal(w.prepares, 0); assert.equal(w.service.state.nextCheckAt, monday + AUTO_BACKUP_INTERVAL);
  w.setTime(monday + AUTO_BACKUP_INTERVAL - 1); await w.service.check(); assert.equal(w.prepares, 0);
  w.setTime(monday + AUTO_BACKUP_INTERVAL); await w.service.check(); assert.equal(w.external.size, 1);
  w.setTime(monday + 86_400_000); await w.service.check(); assert.equal(w.external.size, 1); assert.equal(w.catalog!.entries[0]!.day, "2026-10-19");
});
test("R06 unchanged working data does not hide an inaccessible external backup", async () => {
  const w = world(); await w.service.retry(); w.setTime(monday + AUTO_BACKUP_INTERVAL); w.faults.verify = true;
  const prepares = w.prepares; await w.service.check();
  assert.equal(w.service.state.error, "AUTO_VERIFICATION_FAILED"); assert.equal(w.prepares, prepares); assert.equal(w.external.size, 1);
});
test("R06 deleted current backup is recreated without a business change and keeps healthy daily predecessors", async () => {
  const w = world();
  for (const day of [0, 1, 2]) { w.change(); w.setTime(monday + day * 86_400_000); await w.service.retry(); }
  const before = copy(w.catalog!); const missing = before.entries[0]!; w.external.delete(missing.backupId);
  await w.service.retry();
  assert.equal(w.service.state.error, null); assert.equal(w.catalog!.entries.length, 3); assert.notEqual(w.catalog!.entries[0]!.backupId, missing.backupId);
  assert.deepEqual(w.catalog!.entries.slice(1).map((e) => e.backupId), before.entries.slice(1).map((e) => e.backupId));
  assert.ok(before.entries.slice(1).every((e) => w.external.has(e.backupId))); assert.equal(w.removed.has(missing.backupId), false);
});
test("R06 missing historical version is removed only from metadata; unchanged current data is not duplicated", async () => {
  const w = world();
  for (const day of [0, 1, 2]) { w.change(); w.setTime(monday + day * 86_400_000); await w.service.retry(); }
  const before = copy(w.catalog!); w.external.delete(before.entries[1]!.backupId);
  await w.service.retry(); assert.equal(w.service.state.error, null); assert.equal(w.catalog!.sequence, before.sequence);
  assert.deepEqual(w.catalog!.entries.map((e) => e.backupId), [before.entries[0]!.backupId, before.entries[2]!.backupId]); assert.equal(w.removed.size, 0);
});
test("R06 all deleted backup files restart the same managed destination even with unchanged SQLite", async () => {
  const w = world(); await w.service.retry(); const before = copy(w.catalog!); w.external.clear();
  await w.service.retry(); assert.equal(w.service.state.error, null); assert.equal(w.external.size, 1);
  assert.equal(w.catalog!.sequence, before.sequence + 1); assert.equal(w.catalog!.destination.kind, "DOWNLOADS"); assert.equal(w.archives.length, 0);
});
test("R06 a partial observation with later provider failure cannot discard missing metadata or delete healthy history", async () => {
  const w = world();
  for (const day of [0, 1, 2]) { w.change(); w.setTime(monday + day * 86_400_000); await w.service.retry(); }
  const before = copy(w.catalog!); let calls = 0;
  w.files.inspect = async () => { if (++calls === 1) return "MISSING"; throw new AutomaticBackupError("AUTO_FOLDER_UNAVAILABLE"); };
  await w.service.retry(); assert.deepEqual(w.catalog, before); assert.equal(w.external.size, 3); assert.equal(w.removed.size, 0);
  assert.equal(w.service.state.error, "AUTO_FOLDER_UNAVAILABLE");
});
test("R06 a deleted replacement cannot cause cleanup to delete its last valid predecessor before repair succeeds", async () => {
  const w = world(); await w.service.retry(); const predecessor = w.catalog!.entries[0]!;
  w.change(); w.faults.remove = true; await w.service.retry(); const lost = w.catalog!.entries[0]!;
  assert.equal(w.catalog!.retired[0]!.backupId, predecessor.backupId); w.external.delete(lost.backupId);
  w.faults.remove = false; w.faults.publish = true; const failed = w.make(); await failed.check();
  assert.equal(failed.state.error, "AUTO_FOLDER_UNAVAILABLE");
  assert.ok(w.external.has(predecessor.backupId)); assert.equal(w.removed.has(predecessor.backupId), false);
  assert.equal(w.catalog!.entries[0]!.backupId, predecessor.backupId);
  w.faults.publish = false; const repaired = w.make(); await repaired.check();
  assert.ok(w.external.has(w.catalog!.entries[0]!.backupId)); assert.notEqual(w.catalog!.entries[0]!.backupId, lost.backupId);
  assert.equal(w.catalog!.retired.length, 0); assert.equal(repaired.state.error, null);
});
test("R06 auto keeps latest Monday/Tuesday/Wednesday, replaces only today, and retires Monday after Thursday succeeds", async () => {
  const w = world(); await w.service.retry(); const mon = w.catalog!.entries[0]!.backupId;
  w.change(); w.setTime(monday + AUTO_BACKUP_INTERVAL); await w.service.retry(); assert.equal(w.external.size, 1); assert.ok(w.removed.has(mon));
  for (const day of [1, 2]) { w.change(); w.setTime(monday + day * 86_400_000); await w.service.check(); }
  assert.deepEqual(w.catalog!.entries.map((e) => e.day), ["2026-10-21", "2026-10-20", "2026-10-19"]);
  const oldIds = w.catalog!.entries.map((e) => e.backupId);
  w.change(); w.setTime(monday + 2 * 86_400_000 + AUTO_BACKUP_INTERVAL); await w.service.retry();
  assert.deepEqual(w.catalog!.entries.slice(1).map((e) => e.backupId), oldIds.slice(1));
  w.change(); w.setTime(monday + 3 * 86_400_000); await w.service.check();
  assert.deepEqual(w.catalog!.entries.map((e) => e.day), ["2026-10-22", "2026-10-21", "2026-10-20"]); assert.equal(w.external.size, 3);
});
test("R06 disappearance between native publication and cleanup preserves the previous valid file", async () => {
  const w = world(); await w.service.retry(); const predecessor = w.catalog!.entries[0]!;
  const publish = w.files.publish;
  w.files.publish = async (...args) => { const receipt = await publish(...args); w.external.delete(args[0].backupId); return receipt; };
  w.change(); await w.service.retry();
  assert.equal(w.service.state.error, "AUTO_VERIFICATION_FAILED"); assert.equal(w.removed.size, 0);
  assert.ok(w.external.has(predecessor.backupId)); assert.equal(w.catalog!.retired[0]!.backupId, predecessor.backupId);
  w.files.publish = publish; const restarted = w.make(); await restarted.retry();
  assert.equal(restarted.state.error, null); assert.equal(w.catalog!.retired.length, 0); assert.equal(w.external.size, 1);
});
test("R06 auto gaps preserve actual older dates in free slots; no fictional daily copies", async () => {
  const w = world();
  for (const day of [0, 1, 7]) { w.change(); w.setTime(monday + day * 86_400_000); await w.service.retry(); }
  assert.deepEqual(w.catalog!.entries.map((e) => e.day), ["2026-10-26", "2026-10-20", "2026-10-19"]); assert.equal(w.external.size, 3);
});
test("R06 auto failed preparation, publication or old-file verification never deletes the former trio", async () => {
  for (const fault of ["prepare", "publish", "verify"] as const) {
    const w = world();
    for (const day of [0, 1, 2]) { w.change(); w.setTime(monday + day * 86_400_000); await w.service.retry(); }
    const before = copy(w.catalog!.entries); const files = [...w.external.keys()];
    w.change(); w.setTime(monday + 3 * 86_400_000); w.faults[fault] = true; await w.service.retry();
    assert.deepEqual(w.catalog!.entries, before); assert.deepEqual([...w.external.keys()], files); assert.notEqual(w.service.state.error, null);
  }
});
test("R06 auto restart after publish/catalog failure reuses one receipt and the same pending source", async () => {
  const w = world(); await w.service.retry(); const old = w.catalog!.entries[0]!;
  w.change(); w.faults.beforeCommit = true; await w.service.retry(); const pending = w.catalog!.pending!;
  assert.equal(w.external.size, 2); assert.equal(w.catalog!.entries[0]!.backupId, old.backupId); assert.ok(w.prepared.has(pending.backupId));
  const preparations = w.prepares; w.faults.beforeCommit = false;
  const restarted = w.make(); await restarted.check();
  assert.equal(w.prepares, preparations); assert.equal(w.catalog!.entries[0]!.backupId, pending.backupId); assert.equal(w.catalog!.pending, null); assert.equal(w.external.size, 1);
  assert.equal(restarted.state.error, null); assert.equal(w.prepared.has(pending.backupId), false);
});
test("R06 uncertain catalog write already committed is recovered by cleaning retired files without repeating publication", async () => {
  const w = world(); await w.service.retry(); w.change(); w.faults.afterCommit = true; await w.service.retry();
  assert.equal(w.catalog!.pending, null); assert.equal(w.catalog!.retired.length, 1); const id = w.catalog!.entries[0]!.backupId;
  const count = w.events.filter((e) => e.startsWith("publish:")).length;
  w.faults.afterCommit = false; await w.make().check();
  assert.equal(w.catalog!.entries[0]!.backupId, id); assert.equal(w.catalog!.retired.length, 0); assert.equal(w.external.size, 1);
  assert.equal(w.events.filter((e) => e.startsWith("publish:")).length, count);
});
test("R06 auto deletion failure retains the new verified copy and a durable retry queue", async () => {
  const w = world(); await w.service.retry(); w.change(); w.faults.remove = true; await w.service.retry();
  assert.equal(w.service.state.error, "AUTO_CLEANUP_PENDING"); assert.equal(w.catalog!.retired.length, 1); assert.equal(w.external.size, 2);
  assert.equal(w.service.state.lastSaved?.filename, w.catalog!.entries[0]!.filename);
  w.faults.remove = false; await w.make().check(); assert.equal(w.catalog!.retired.length, 0); assert.equal(w.external.size, 1);
});
test("R06 auto failure stays visible after service recreation until a real successful retry", async () => {
  const w = world(); await w.service.retry(); w.change(); w.faults.prepare = true; await w.service.retry();
  const restarted = w.make(); await restarted.check();
  assert.equal(restarted.state.error, "AUTO_SOURCE_UNAVAILABLE"); assert.equal(w.external.size, 1);
  w.faults.prepare = false; await restarted.retry(); assert.equal(restarted.state.error, null); assert.equal(await w.store.readFailure(), null);
});
test("R06 backward time and changed time zone stop before another snapshot, publication or deletion", async () => {
  for (const zone of [false, true]) {
    const w = world(); await w.service.retry(); const before = copy(w.catalog!); const preparations = w.prepares;
    w.change(); if (zone) w.setZone(-180); else w.setTime(monday - 1000); await w.service.retry();
    assert.equal(w.service.state.error, "AUTO_CLOCK_CHANGED"); assert.equal(w.prepares, preparations); assert.deepEqual(w.catalog, before); assert.equal(w.external.size, 1);
  }
});
test("R06 changing destination preserves its former catalog and files, even with a blocked old cleanup", async () => {
  const w = world(); await w.service.retry(); w.change(); w.faults.remove = true; await w.service.retry();
  const old = copy(w.catalog!); const oldFiles = [...w.external.keys()];
  w.location({ kind: "DIRECTORY", uri: "content://synthetic/tree/new" }); await w.service.retry();
  assert.equal(w.archives.length, 1); assert.deepEqual(w.archives[0], old); assert.ok(oldFiles.every((id) => w.external.has(id)));
  assert.equal(w.catalog!.destination.kind, "DIRECTORY"); assert.equal(w.catalog!.entries.length, 1); assert.equal(w.service.state.error, null);
});
test("R06 automatic pending publication also survives a changed destination as preserved old-location work", async () => {
  const w = world(); w.faults.publish = true; await w.service.retry(); const pending = w.catalog!.pending!;
  w.faults.publish = false; w.location({ kind: "DIRECTORY", uri: "content://synthetic/tree/new" }); await w.service.retry();
  assert.equal(w.archives[0]!.pending!.backupId, pending.backupId); assert.ok(w.prepared.has(pending.backupId)); assert.equal(w.catalog!.pending, null);
});
test("R06 duplicate ticks cannot overlap and maintenance drains the entire automatic publication", async () => {
  const w = world(); let release!: () => void; const wait = new Promise<void>((resolve) => { release = resolve; });
  const publish = w.files.publish; w.files.publish = async (...args) => { await wait; return publish(...args); };
  const saving = w.service.retry(); await new Promise<void>((resolve) => setImmediate(resolve)); await w.service.check(); assert.equal(w.prepares, 1);
  w.commands.pause(); let drained = false; const idle = w.commands.idle().then(() => { drained = true; }); await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(drained, false);
  release(); await saving; await idle; assert.equal(drained, true); assert.equal(w.external.size, 1);
});
test("R06 unavailable automatic storage never opens SQLite or private metadata", async () => {
  const w = world(); await w.make(false).retry(); assert.equal(w.catalog, null); assert.equal(w.prepares, 0);
});
test("R06 malformed/duplicate catalog entries, foreign publication names and imported paths cannot become retention authority", async () => {
  const w = world(); await w.service.retry(); const good = w.catalog!;
  for (const bad of [{ ...good, entries: [good.entries[0], good.entries[0]] }, { ...good, sourceUri: "/foreign" },
    { ...good, pending: { ...good.entries[0], backupId: "../foreign" } }, { ...good, entries: [{ ...good.entries[0], filename: "manual.atbackup" }] },
    { ...good, destination: { kind: "DIRECTORY", uri: "file:///foreign" } }]) assert.throws(() => parseAutomaticCatalog(bad));
  assert.equal(w.external.size, 1);
});
