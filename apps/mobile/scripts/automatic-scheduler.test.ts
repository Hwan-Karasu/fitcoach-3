import assert from "node:assert/strict";
import test from "node:test";
import { AutomaticBackupScheduler, QUIET_RETRY_MS } from "../src/app/runtime/AutomaticBackupScheduler.ts";
import { TRAINING_QUIET_MS, trackTrainingActivity } from "../src/app/runtime/TrainingActivity.ts";
import { AUTO_BACKUP_INTERVAL, type AutomaticBackupPort, type AutomaticBackupState } from "../src/features/backup/public.ts";
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function world() {
  let now = 0; let checks = 0; let release: (() => void) | null = null; let deferred = false;
  let state: AutomaticBackupState = { available: true, phase: "IDLE", progress: null, nextCheckAt: null, versions: 0, lastSaved: null, error: null, errorStage: null, lastRun: null };
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
test("AUTO-BACKUP-3 во время тренировки автокопия не стартует: попытка откладывается на минуту, после паузы — проходит", async () => {
  let training = true;
  let now = 0; let checks = 0;
  const state: AutomaticBackupState = { available: true, phase: "IDLE", progress: null, nextCheckAt: null, versions: 0, lastSaved: null, error: null, errorStage: null, lastRun: null };
  const timers = new Map<() => void, number>();
  const port: AutomaticBackupPort = { get state() { return state; }, subscribe: () => () => undefined,
    check: async () => { checks++; }, retry: async () => { checks++; } };
  const scheduler = new AutomaticBackupScheduler(port, { now: () => now,
    schedule: (delay, task) => { timers.set(task, now + delay); return () => { timers.delete(task); }; } }, () => !training);
  const advance = async (ms: number) => { now += ms; for (const [task, due] of [...timers]) if (due <= now) { timers.delete(task); task(); } await tick(); };
  scheduler.setActive(true); await tick();
  assert.equal(checks, 0, "идёт тренировка — копия не стартует");
  assert.deepEqual([...timers.values()], [QUIET_RETRY_MS], "одна отложенная попытка, без цикла");
  await advance(QUIET_RETRY_MS); assert.equal(checks, 0, "через минуту тренировка ещё идёт");
  training = false;
  await advance(QUIET_RETRY_MS); assert.equal(checks, 1, "пауза — копия проходит");
  scheduler.setActive(false); assert.equal(timers.size, 0, "в фоне отложенная попытка снимается"); scheduler.dispose();
});

test("AUTO-BACKUP-3 тренировка идёт, пока на панели есть таймер или были записи последние 3 минуты", () => {
  let now = 1_000_000; let timers: readonly { pausedLeftMs: number | null }[] = [];
  let emit!: () => void;
  const activity = trackTrainingActivity({ restTimers: { list: () => timers },
    subscriptions: [(listener) => { emit = listener; return () => { emit = () => undefined; }; }] }, () => now);
  assert.equal(activity.quiet(), true, "ничего не происходило");
  emit(); now += TRAINING_QUIET_MS - 1;
  assert.equal(activity.quiet(), false, "запись подхода меньше 3 минут назад");
  now += 1; assert.equal(activity.quiet(), true);
  timers = [{ pausedLeftMs: null }]; assert.equal(activity.quiet(), false, "идёт таймер отдыха");
  timers = [{ pausedLeftMs: 30_000 }]; assert.equal(activity.quiet(), true, "забытый на паузе таймер автокопию не держит");
  activity.dispose(); timers = [];
  emit(); assert.equal(activity.quiet(), true, "после отписки записи не учитываются");
});

test("R06 a backward clock jump cannot overflow the platform timer into a rapid retry loop", async () => {
  const w = world(); w.scheduler.setActive(true); await tick();
  const year = 365 * 86_400_000; await w.advance(-year); w.scheduler.setActive(true);
  assert.deepEqual([...w.timers.values()], [-year + AUTO_BACKUP_INTERVAL]); assert.equal(w.checks, 1); w.scheduler.dispose();
});
