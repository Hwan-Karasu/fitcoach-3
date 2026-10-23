import assert from "node:assert/strict";
import test from "node:test";
import { RestoreActionsService, RestoreActionError, type RestorePreview, type RestoreJobsPort, type ReturnPointSummary } from "../src/features/backup/public.ts";
import { RuntimeCommandGate } from "../src/app/runtime/RuntimeCommandGate.ts";

const preview: RestorePreview = { id: "10000000-0000-4000-8000-000000000001", kind: "RESTORE",
  createdAt: "2026-10-23T12:00:00.000Z", activeClients: 25, archivedClients: 0 };
const point: ReturnPointSummary = { id: "20000000-0000-4000-8000-000000000002", createdAt: "2026-10-23T11:00:00.000Z" };
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function latch() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
function world(overrides: Partial<RestoreJobsPort> = {}, enabled = true) {
  const commands = new RuntimeCommandGate(); let ready = true; let currentPoint: ReturnPointSummary | null = point;
  const calls = { prepare: 0, apply: 0, discard: [] as string[], deleted: [] as string[], recover: 0 };
  const jobs: RestoreJobsPort = {
    prepareFile: async () => { calls.prepare++; return preview; },
    prepareReturn: async (id) => { assert.equal(id, point.id); return { ...preview, kind: "RETURN" }; },
    apply: async () => { calls.apply++; return "COMMITTED"; },
    discard: async (id) => { calls.discard.push(id); }, readPoint: async () => currentPoint,
    deletePoint: async (id) => { calls.deleted.push(id); currentPoint = null; }, recover: async () => { calls.recover++; }, ...overrides,
  };
  const service = new RestoreActionsService({ enabled, jobs, read: (task) => commands.run(task), ready: () => ready });
  return { service, commands, calls, ready: (value: boolean) => { ready = value; } };
}

test("R06 restore preview never applies data; only its exact confirmation ID can proceed", async () => {
  const w = world(); await w.service.chooseFile();
  assert.equal(w.service.state.phase, "PREVIEW"); assert.equal(w.calls.apply, 0);
  assert.deepEqual(await w.service.confirmPreview("stale"), { kind: "FAILED", code: "RESTORE_STALE_PREVIEW" });
  assert.equal(w.calls.apply, 0); assert.equal(w.service.state.preview?.id, preview.id);
  assert.deepEqual(await w.service.confirmPreview(preview.id), { kind: "RESTORED" });
  assert.equal(w.calls.apply, 1); assert.equal(w.service.state.preview, null);
  assert.deepEqual(await w.service.confirmPreview(preview.id), { kind: "FAILED", code: "RESTORE_STALE_PREVIEW" }); assert.equal(w.calls.apply, 1);
});
test("R06 cancelled picker preserves point without preparing a confirmation or replacing data", async () => {
  const w = world({ prepareFile: async () => null }); await w.service.refresh();
  assert.deepEqual(await w.service.chooseFile(), { kind: "CANCELLED" });
  assert.equal(w.service.state.preview, null); assert.deepEqual(w.service.state.point, point); assert.equal(w.calls.apply, 0);
});
test("R06 Back/cancel discards only the prepared job and never invokes replacement", async () => {
  const w = world(); await w.service.chooseFile(); await w.service.cancelPreview(); await w.service.cancelPreview();
  assert.deepEqual(w.calls.discard, [preview.id]); assert.equal(w.service.state.preview, null); assert.equal(w.calls.apply, 0);
});
test("R06 duplicate selection cannot open another picker and whole-read admission waits for preparation", async () => {
  const gate = latch(); let opened = 0;
  const w = world({ prepareFile: async () => { opened++; await gate.promise; return preview; } });
  const preparing = w.service.chooseFile(); await tick();
  assert.deepEqual(await w.service.chooseFile(), { kind: "FAILED", code: "RESTORE_BUSY" }); assert.equal(opened, 1);
  w.commands.pause(); let drained = false; const draining = w.commands.idle().then(() => { drained = true; }); await tick(); assert.equal(drained, false);
  gate.release(); await preparing; await draining; assert.equal(drained, true); w.commands.resume(); await w.service.cancelPreview();
});
test("R06 confirmation enters maintenance outside ordinary command admission, avoiding self-drain deadlock", { timeout: 2000 }, async () => {
  const commands = new RuntimeCommandGate(); let applied = false;
  const w = world(); const service = new RestoreActionsService({ enabled: true, ready: () => true, read: (task) => commands.run(task), jobs: {
    prepareFile: async () => preview, prepareReturn: async () => ({ ...preview, kind: "RETURN" }),
    apply: async () => { commands.pause(); await commands.idle(); applied = true; commands.resume(); return "COMMITTED"; },
    discard: async () => undefined, readPoint: async () => point, deletePoint: async () => undefined, recover: async () => undefined,
  } });
  await service.chooseFile(); assert.equal((await service.confirmPreview(preview.id)).kind, "RESTORED"); assert.equal(applied, true);
  assert.equal(w.calls.apply, 0);
});
test("R06 double confirmation and unmount cancellation cannot interrupt an admitted replacement", async () => {
  const gate = latch(); let applied = 0;
  const w = world({ apply: async () => { applied++; await gate.promise; return "COMMITTED"; } }); await w.service.chooseFile();
  const applying = w.service.confirmPreview(preview.id); await tick();
  assert.deepEqual(await w.service.confirmPreview(preview.id), { kind: "FAILED", code: "RESTORE_BUSY" });
  assert.deepEqual(await w.service.cancelPreview(), { kind: "FAILED", code: "RESTORE_BUSY" }); assert.deepEqual(w.calls.discard, []);
  gate.release(); await applying; assert.equal(applied, 1); assert.equal(w.service.state.notice, "RESTORED");
});
test("R06 stale data discovered at confirmation discards the preview and requires a fresh selection", async () => {
  const w = world({ apply: async () => { throw new RestoreActionError("RESTORE_STALE_PREVIEW"); } }); await w.service.chooseFile();
  assert.deepEqual(await w.service.confirmPreview(preview.id), { kind: "FAILED", code: "RESTORE_STALE_PREVIEW" });
  assert.equal(w.service.state.preview, null); assert.equal(w.service.state.notice, null); assert.deepEqual(w.calls.discard, [preview.id]);
});
test("R06 incomplete recovery retains the prepared job and blocks ordinary actions until retry succeeds", async () => {
  let recoverable = false;
  const w = world({ apply: async () => { throw new RestoreActionError("RESTORE_RECOVERY_REQUIRED"); },
    recover: async () => { if (!recoverable) throw new Error("private native failure"); } }); await w.service.chooseFile();
  await w.service.confirmPreview(preview.id); assert.equal(w.service.state.phase, "RECOVERY_REQUIRED"); assert.deepEqual(w.calls.discard, []);
  assert.deepEqual(await w.service.chooseFile(), { kind: "FAILED", code: "RESTORE_BUSY" });
  assert.deepEqual(await w.service.recover(), { kind: "FAILED", code: "RESTORE_RECOVERY_REQUIRED" });
  assert.equal(w.service.state.phase, "RECOVERY_REQUIRED"); recoverable = true; await w.service.recover();
  assert.equal(w.service.state.phase, "IDLE"); assert.equal(w.service.state.error, null); assert.deepEqual(w.calls.discard, [preview.id]);
});
test("R06 Return has its own explicit preview and successful outcome", async () => {
  const w = world(); await w.service.refresh(); await w.service.previewReturn();
  assert.equal(w.service.state.preview?.kind, "RETURN"); assert.equal(w.calls.apply, 0);
  assert.deepEqual(await w.service.confirmPreview(preview.id), { kind: "RETURNED" }); assert.equal(w.service.state.notice, "RETURNED");
});
test("R06 point deletion requires the currently displayed ID and preserves a pending preview", async () => {
  const w = world(); await w.service.refresh();
  assert.equal((await w.service.deletePoint("stale")).kind, "FAILED"); assert.deepEqual(w.calls.deleted, []);
  await w.service.chooseFile(); assert.equal((await w.service.deletePoint(point.id)).kind, "FAILED"); assert.deepEqual(w.calls.deleted, []);
  await w.service.cancelPreview(); assert.deepEqual(await w.service.deletePoint(point.id), { kind: "POINT_DELETED" });
  assert.equal(w.service.state.point, null); assert.deepEqual(w.calls.deleted, [point.id]);
});
test("R06 unavailable/not-ready runtime never invokes a restore reader or file picker", async () => {
  const disabled = world({}, false); assert.equal((await disabled.service.chooseFile()).kind, "FAILED"); assert.equal(disabled.calls.prepare, 0);
  const w = world(); w.ready(false); assert.deepEqual(await w.service.chooseFile(), { kind: "FAILED", code: "RESTORE_NOT_READY" }); assert.equal(w.calls.prepare, 0);
});
test("R06 source exceptions expose fixed errors, and screen refresh preserves a completed success notice", async () => {
  const failed = world({ prepareFile: async () => { throw new Error("/private/source SQLite code"); } });
  assert.deepEqual(await failed.service.chooseFile(), { kind: "FAILED", code: "RESTORE_SOURCE_UNAVAILABLE" }); assert.equal(failed.service.state.preview, null);
  const w = world(); await w.service.chooseFile(); await w.service.confirmPreview(preview.id); await w.service.refresh();
  assert.equal(w.service.state.notice, "RESTORED");
});
