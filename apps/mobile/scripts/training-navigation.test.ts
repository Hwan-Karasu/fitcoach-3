import assert from "node:assert/strict";
import test from "node:test";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { useWorkoutSnapshot } from "../src/features/training/execution/presentation/useWorkoutSnapshot.ts";
import { useProgramData } from "../src/features/training/plans/presentation/useProgramData.ts";
import type { TrainingPlansRepositoryPort } from "../src/features/training/plans/domain/TrainingPlansRepositoryPort.ts";
import type { TrainingExecutionPort } from "../src/features/training/execution/domain/TrainingExecutionPort.ts";
import type { PlannedWorkout } from "../src/features/training/plans/domain/SimplePlanModel.ts";
import type { WorkoutExecution } from "../src/features/training/execution/domain/ExecutionModel.ts";
import { navigationPerformance } from "../src/shared/diagnostics/NavigationPerformance.ts";
import { useActiveWorkoutCards } from "../src/features/training/execution/presentation/useActiveWorkoutCards.ts";
import { useParticipantGroup } from "../src/features/training/plans/presentation/useParticipantGroup.ts";
import type { ActiveWorkoutCard, ActiveWorkoutsPort } from "../src/features/training/execution/domain/ExecutionModel.ts";
import type { TrainingPlansCommittedChange } from "../src/features/training/plans/domain/TrainingPlansRepositoryPort.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const empty: WorkoutExecution = { session: null, facts: new Map(), notes: new Map() };
const workout: PlannedWorkout = { id: "same-workout", title: "Synthetic", exercises: [] };
const slot = (weekIndex: number) => ({ clientId: "client", programId: "program", plannedWorkoutId: workout.id, weekIndex });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("changing a diary week filters global cards without rereading every client", async () => {
  let reads = 0;
  let notify!: () => void;
  const cards: readonly ActiveWorkoutCard[] = [1, 2, 3].map((week) => ({ slot: slot(week), clientName: "Synthetic",
    programTitle: "Synthetic", workoutTitle: "Synthetic" }));
  const active: ActiveWorkoutsPort = { list: async () => { reads += 1; return cards; },
    subscribe: (listener) => { notify = listener; return () => undefined; } };
  let shown: readonly ActiveWorkoutCard[] = [];
  function Probe({ week }: { week: number }) { shown = useActiveWorkoutCards(active, slot(week)); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(createElement(Probe, { week: 1 })); });
  assert.deepEqual(shown.map((card) => card.slot.weekIndex), [2, 3]);
  await act(async () => { renderer.update(createElement(Probe, { week: 2 })); });
  assert.equal(reads, 1);
  assert.deepEqual(shown.map((card) => card.slot.weekIndex), [1, 3]);
  await act(async () => { notify(); });
  assert.equal(reads, 2, "committed changes still refresh cards");
  await act(async () => { renderer.unmount(); });
});

test("P01 programme switcher refreshes on another participant archive and restore without reloading the displayed plan", async () => {
  let archived = false;
  let programReads = 0;
  let notify!: (change: TrainingPlansCommittedChange) => void;
  const own = { clientId: "client", programId: "program", mesocycleId: "own-cycle" };
  const other = { clientId: "other", programId: "other-program", mesocycleId: "other-cycle" };
  const program = { id: "program", title: "Synthetic", kind: "PERIODIZED", revision: 1, createdAt: "2026-10-26", memberClientIds: ["client"] };
  const plans = {
    getProgram: async () => { programReads += 1; return program; }, selectProgram: async () => undefined,
    getPeriodizedPlan: async () => ({ program, selectedMesocycleId: "own-cycle", mesocycles: [{ id: "own-cycle", lineageId: "own-lineage", title: "Own", weeks: [] }] }),
    getMesocycleGroup: async () => archived ? [own] : [own, other],
    subscribeCommittedChanges: (listener: typeof notify) => { notify = listener; return () => undefined; },
  } as unknown as TrainingPlansRepositoryPort;
  let latest!: ReturnType<typeof useProgramData>;
  function Probe() { latest = useProgramData({ clientId: "client", programId: "program", repository: plans,
    onRequestedWeek: () => undefined, onMessage: () => undefined }); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(createElement(Probe)); });
  assert.deepEqual(latest.group, [own, other]);
  archived = true;
  await act(async () => { notify({ clientIds: ["other"] }); });
  assert.deepEqual(latest.group, [own]);
  assert.equal(programReads, 1);
  archived = false;
  await act(async () => { notify({ clientIds: ["other"] }); });
  assert.deepEqual(latest.group, [own, other]);
  assert.equal(programReads, 1);
  await act(async () => { renderer.unmount(); });
});

test("P01 diary group availability refreshes for each workout, membership and order change; stale identities are blocked", async () => {
  let reads = 0;
  let notify!: (change: TrainingPlansCommittedChange) => void;
  let hold = false;
  const pending = deferred<readonly { clientId: string; programId: string; mesocycleId: string }[]>();
  const plans = { getMesocycleGroup: async () => { reads += 1; return hold ? pending.promise : [
    { clientId: "client", programId: "program", mesocycleId: "cycle" },
    { clientId: "other", programId: "program", mesocycleId: "other-cycle" }]; },
  subscribeCommittedChanges: (listener: typeof notify) => { notify = listener; return () => undefined; } } as unknown as TrainingPlansRepositoryPort;
  let latest!: ReturnType<typeof useParticipantGroup>;
  function Probe({ workout, client = "client" }: { workout: string; client?: string }) {
    latest = useParticipantGroup(plans, client, "program", "cycle", workout, undefined); return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(createElement(Probe, { workout: "week-1-workout" })); });
  assert.equal(latest.fresh, true);
  await act(async () => { renderer.update(createElement(Probe, { workout: "week-2-workout" })); });
  assert.equal(reads, 2);
  await act(async () => { notify({ clientIds: ["client"], selectionOnly: true }); });
  assert.equal(reads, 2);
  await act(async () => { notify({ clientIds: ["client"] }); });
  assert.equal(reads, 3);
  await act(async () => { notify({ clientIds: ["other"], orderOnly: true }); });
  assert.equal(reads, 4, "reordering invalidates ordinal availability");
  hold = true;
  await act(async () => { renderer.update(createElement(Probe, { workout: "other-workout", client: "other" })); });
  assert.equal(latest.fresh, false, "old group's buttons cannot switch a newly selected participant");
  await act(async () => { pending.resolve([]); });
  assert.deepEqual(latest.members, []);
  assert.equal(latest.fresh, true);
  await act(async () => { renderer.unmount(); });
});

test("diary starts independent reads together and cannot unlock a failed or superseded week", async () => {
  const calls: string[] = [];
  const reads = new Map<number, ReturnType<typeof deferred<{ workout: PlannedWorkout } | null>>>();
  const plans = { subscribeCommittedChanges: () => () => undefined, findWorkout: async (_client: string, _program: string, _workout: string, week: number) => {
    calls.push(`plan:${week}`); const pending = deferred<{ workout: PlannedWorkout } | null>(); reads.set(week, pending); return pending.promise;
  } } as unknown as TrainingPlansRepositoryPort;
  const execution = {
    subscribeCommittedChanges: () => () => undefined,
    getWorkoutWithPrevious: async (_slot: unknown, queries: Promise<unknown>) => {
      calls.push("execution"); await queries; return { current: empty, previous: new Map() };
    }, getConfirmationMode: async () => { calls.push("mode"); return "AUTO"; },
  } as unknown as TrainingExecutionPort;
  let latest!: ReturnType<typeof useWorkoutSnapshot>;
  function Probe({ week, version = 0 }: { week: number; version?: number }) {
    latest = useWorkoutSnapshot(slot(week), plans, execution, version); return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(createElement(Probe, { week: 1 })); });
  assert.deepEqual(calls, ["plan:1", "execution", "mode"], "execution/mode started while plan is pending");
  await act(async () => { reads.get(1)!.resolve({ workout }); });
  assert.equal(latest.loadedKeyRef.current, latest.slotKeyRef.current);
  await act(async () => { renderer.update(createElement(Probe, { week: 2 })); });
  assert.notEqual(latest.loadedKeyRef.current, latest.slotKeyRef.current);
  await act(async () => { reads.get(2)!.reject(new Error("synthetic read failure")); });
  assert.equal(latest.loadFailed, true);
  assert.notEqual(latest.loadedKeyRef.current, latest.slotKeyRef.current, "failed week cannot save previous week's identical set IDs");
  await act(async () => { renderer.update(createElement(Probe, { week: 2, version: 1 })); });
  await act(async () => { reads.get(2)!.resolve({ workout }); });
  assert.equal(latest.loadFailed, false);
  assert.equal(latest.loadedKeyRef.current, latest.slotKeyRef.current);
  await act(async () => { renderer.update(createElement(Probe, { week: 3 })); });
  await act(async () => { renderer.update(createElement(Probe, { week: 4 })); });
  await act(async () => { reads.get(4)!.resolve({ workout: { ...workout, title: "Fourth week" } }); });
  await act(async () => { reads.get(3)!.resolve({ workout: { ...workout, title: "Stale third week" } }); });
  assert.equal(latest.workout!.title, "Fourth week");
  assert.equal(latest.loadedKeyRef.current, latest.slotKeyRef.current);
  await act(async () => { renderer.unmount(); });
});

test("initial diary failure is retryable and missing workouts complete without a stale result", async () => {
  let fail = true;
  const plans = { subscribeCommittedChanges: () => () => undefined, findWorkout: async () => { if (fail) throw new Error("synthetic"); return null; } } as unknown as TrainingPlansRepositoryPort;
  const execution = { subscribeCommittedChanges: () => () => undefined, getWorkoutWithPrevious: async (_slot: unknown, queries: Promise<unknown>) => {
    await queries; return { current: empty, previous: new Map() };
  }, getConfirmationMode: async () => "AUTO" } as unknown as TrainingExecutionPort;
  let latest!: ReturnType<typeof useWorkoutSnapshot>;
  function Probe({ version }: { version: number }) { latest = useWorkoutSnapshot(slot(1), plans, execution, version); return null; }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(createElement(Probe, { version: 0 })); });
  assert.equal(latest.loadFailed, true);
  assert.equal(latest.loadedKeyRef.current, null);
  fail = false;
  await act(async () => { renderer.update(createElement(Probe, { version: 1 })); });
  assert.equal(latest.workout, null);
  assert.equal(latest.loadFailed, false);
  await act(async () => { renderer.unmount(); });
});

test("hidden program defers participant data and group reads until focus returns", async () => {
  const reads: string[] = [];
  const plans = { getProgram: async (client: string) => { reads.push(client); return { id: "program", kind: "PERIODIZED" }; },
    selectProgram: async () => undefined,
    getPeriodizedPlan: async (client: string) => ({ program: { id: "program" }, selectedMesocycleId: `cycle-${client}`, mesocycles: [{ id: `cycle-${client}` }] }),
    getMesocycleGroup: async (client: string) => { reads.push(`group-${client}`); return []; },
    subscribeCommittedChanges: () => () => undefined } as unknown as TrainingPlansRepositoryPort;
  function Probe({ client, focused }: { client: string; focused: boolean }) {
    useProgramData({ clientId: client, programId: "program", repository: plans, focused,
      onRequestedWeek: () => undefined, onMessage: () => undefined }); return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(createElement(Probe, { client: "a", focused: true })); });
  assert.deepEqual(reads, ["a", "group-a"]);
  await act(async () => { renderer.update(createElement(Probe, { client: "a", focused: false })); });
  await act(async () => { renderer.update(createElement(Probe, { client: "b", focused: false })); });
  assert.deepEqual(reads, ["a", "group-a"]);
  await act(async () => { renderer.update(createElement(Probe, { client: "b", focused: true })); });
  assert.deepEqual(reads, ["a", "group-a", "b", "group-b"]);
  await act(async () => { renderer.update(createElement(Probe, { client: "b", focused: false })); });
  await act(async () => { renderer.update(createElement(Probe, { client: "b", focused: true })); });
  assert.equal(reads.filter((read) => read === "b").length, 1, "unchanged plan is retained");
  await act(async () => { renderer.unmount(); });
});

test("navigation diagnostics are opt-in, bounded and contain no identity/input data", () => {
  navigationPerformance.enable(false);
  navigationPerformance.begin("workout-week"); navigationPerformance.read(); navigationPerformance.finish("workout");
  assert.deepEqual(navigationPerformance.snapshot(), []);
  navigationPerformance.enable();
  navigationPerformance.begin("workout-week");
  const end = navigationPerformance.phase("flush"); end(); navigationPerformance.read();
  navigationPerformance.onRender("TrainingWorkout", "update", 2);
  navigationPerformance.finish("program");
  assert.equal(navigationPerformance.snapshot().length, 0, "hidden program cannot finish diary timing");
  navigationPerformance.finish("workout");
  const sample = navigationPerformance.snapshot()[0]!;
  assert.equal(sample.reads, 1); assert.equal(sample.commits, 1); assert.equal(sample.reactMs, 2);
  assert.ok(sample.phases.flush! >= 0);
  navigationPerformance.begin("workout-week");
  const staleCommit = navigationPerformance.ready("workout");
  navigationPerformance.begin("workout-participant");
  staleCommit();
  assert.equal(navigationPerformance.snapshot().length, 1, "a previous frame cannot finish a new navigation");
  for (let i = 0; i < 301; i += 1) {
    navigationPerformance.begin("workout-week"); navigationPerformance.finish("workout");
  }
  assert.equal(navigationPerformance.snapshot().length, 300);
  navigationPerformance.enable(false);
});
