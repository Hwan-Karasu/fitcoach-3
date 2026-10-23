import assert from "node:assert/strict";
import test from "node:test";
import { AutomaticBackupScheduler } from "../src/app/runtime/AutomaticBackupScheduler.ts";
import { AUTO_BACKUP_INTERVAL, type AutomaticBackupPort, type AutomaticBackupState } from "../src/features/backup/public.ts";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function world() {
  let now = 0; let checks = 0; let release: (() => void) | null = null; let deferred = false;
  let state: AutomaticBackupState = { available: true, phase: "IDLE", nextCheckAt: null, versions: 0, lastSaved: null, error: null };
  const timers = new Map<() => void, number>(); const listeners = new Set<() => void>();
  const publish = (patch: Partial<AutomaticBackupState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const check = async () => { checks++; publish({ phase: "CHECKING" });
    if (deferred) await new Promise<void>((resolve) => { release = resolve; });
    publish({ phase: "IDLE", nextCheckAt: now + AUTO_BACKUP_INTERVAL }); };
  const port: AutomaticBackupPort = { get state() { return state; }, subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, check, retry: check };
  const scheduler = new AutomaticBackupScheduler(port, { now: () => now,
    schedule: (delay, task) => { timers.set(task, now + delay); return () => { timers.delete(task); }; } });
  return { scheduler, timers, listeners, get checks() { return checks; }, defer: () => { deferred = true; }, finish: () => { release?.(); },
    advance: async (ms: number) => { now += ms; for (const [task, due] of [...timers]) if (due <= now) { timers.delete(task); task(); } await tick(); } };
}
test("R06 foreground scheduler checks on activation then at the service's 30-minute deadline", async () => {
  const w = world(); w.scheduler.setActive(false); assert.equal(w.checks, 0);
  w.scheduler.setActive(true); await tick(); assert.equal(w.checks, 1);
  await w.advance(AUTO_BACKUP_INTERVAL - 1); assert.equal(w.checks, 1);
  await w.advance(1); assert.equal(w.checks, 2); w.scheduler.dispose();
});
test("R06 background cancels scheduled attempts; foreground return checks immediately without another 30-minute wait", async () => {
  const w = world(); w.scheduler.setActive(true); await tick(); w.scheduler.setActive(false);
  assert.equal(w.timers.size, 0); await w.advance(4 * AUTO_BACKUP_INTERVAL); assert.equal(w.checks, 1);
  w.scheduler.setActive(true); await tick(); assert.equal(w.checks, 2);
  w.scheduler.setActive(true); await tick(); assert.equal(w.checks, 2, "duplicate active events do not create extra attempts"); w.scheduler.dispose();
});
test("R06 scheduler disposal waits neither for nor cancels admitted IO, and late completion cannot restart its timer", async () => {
  const w = world(); w.defer(); w.scheduler.setActive(true); await tick(); assert.equal(w.checks, 1);
  w.scheduler.dispose(); assert.equal(w.timers.size, 0); assert.equal(w.listeners.size, 0);
  w.finish(); await tick(); assert.equal(w.timers.size, 0); assert.equal(w.checks, 1);
});
test("R06 a backward clock jump cannot overflow the platform timer into a rapid retry loop", async () => {
  const w = world(); w.scheduler.setActive(true); await tick();
  const year = 365 * 86_400_000; await w.advance(-year); w.scheduler.setActive(true);
  assert.deepEqual([...w.timers.values()], [-year + AUTO_BACKUP_INTERVAL]); assert.equal(w.checks, 1); w.scheduler.dispose();
});
