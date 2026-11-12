import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { act, createElement, Profiler } from "react";
import TestRenderer from "react-test-renderer";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository } from "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import { DevTrainingExecutionRepository } from "../src/features/training/execution/data/DevTrainingExecutionRepository.ts";
import { useWorkoutSnapshot } from "../src/features/training/execution/presentation/useWorkoutSnapshot.ts";
import { useInputDraft } from "../src/features/training/execution/presentation/useInputDraft.ts";
import { PendingInputWrites } from "../src/features/training/execution/domain/PendingInputWrites.ts";
import { SerialWriteQueue } from "../src/features/training/execution/application/SerialWriteQueue.ts";
import type { WorkoutSlot } from "../src/features/training/execution/domain/ExecutionModel.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";
import type { TrainingPlansRepositoryPort } from "../src/features/training/plans/domain/TrainingPlansRepositoryPort.ts";
import type { TrainingExecutionPort } from "../src/features/training/execution/domain/TrainingExecutionPort.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const WS = "synthetic-snapshot-cache";

test("real SQLite snapshots: warm 1→2→3→1 uses zero reads, ACK and plan edits invalidate dependent snapshots", async () => {
  const db = new DatabaseSync(":memory:");
  const port = nodeSqlitePort(db);
  let reads = 0;
  const shared = new SharedSqliteDatabase(async () => ({ ...port,
    all: (sql, bindings) => { reads += 1; return port.all(sql, bindings); },
    first: (sql, bindings) => { reads += 1; return port.first(sql, bindings); } }));
  const clients = new DevClientRepository(shared, WS, []);
  const plans = new DevTrainingPlansRepository(shared, WS);
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await clients.initialize(); await plans.initialize(); await execution.initialize();
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    const a = (await clients.create({ displayName: "Synthetic A" })).id;
    const b = (await clients.create({ displayName: "Synthetic B" })).id;
    const firstWeek = [{ id: "workout", title: "Workout", exercises: [{ id: "exercise", exerciseId: "sys:synthetic:bench",
      restSec: 90, instruction: null, rir: null, sets: [{ id: "set", reps: 8, repsMax: null, loadGrams: null, durationSec: null, distanceM: null }] }] }];
    const program = await plans.createProgram({ title: "Synthetic", kind: "PERIODIZED", clientIds: [a, b] });
    await plans.createMesocycle(a, program.id, program.revision, { title: "Cycle", weeks: 3, firstWeek, clientIds: [a, b] });
    const slot = async (clientId: string, weekIndex: number): Promise<WorkoutSlot> => ({ clientId, programId: program.id, weekIndex,
      plannedWorkoutId: (await plans.getPeriodizedPlan(clientId, program.id))!.mesocycles[0]!.weeks[weekIndex - 1]!.workouts[0]!.id });
    const slots = await Promise.all([slot(a, 1), slot(a, 2), slot(a, 3), slot(b, 1)]);
    const found = (await plans.findWorkout(a, program.id, slots[0]!.plannedWorkoutId, 1))!;
    const exercise = found.workout.exercises[0]!;
    const write = (load: number, revision: number | null) => execution.saveSet({ slot: slots[0]!, plannedExerciseId: exercise.id,
      exerciseId: exercise.exerciseId, plannedSetId: exercise.sets[0]!.id, position: 0, metrics: ["load", "reps"],
      values: { reps: 8, loadGrams: load, durationSec: null, distanceM: null }, setType: "NORMAL", drops: [], rpe: null, expectedRevision: revision });
    const initial = await write(20_000, null);
    let latest!: ReturnType<typeof useWorkoutSnapshot>;
    let commits = 0;
    function Probe({ selected, version = 0 }: { selected: WorkoutSlot; version?: number }) {
      latest = useWorkoutSnapshot(selected, plans, execution, version);
      // During a cold switch, the displayed label and displayed facts must describe the same snapshot.
      if (latest.state?.session) assert.equal(latest.displayedSlot.weekIndex, latest.state.session.weekIndex);
      return null;
    }
    const element = (selected: WorkoutSlot, version = 0) => createElement(Profiler, { id: "snapshot", onRender: () => { commits += 1; } },
      createElement(Probe, { selected, version }));
    await act(async () => { renderer = TestRenderer.create(element(slots[0]!)); });
    for (const index of [1, 2]) await act(async () => { renderer.update(element(slots[index]!)); });
    for (const index of [0, 1, 2, 0]) {
      reads = 0; commits = 0;
      await act(async () => { renderer.update(element(slots[index]!)); });
      assert.equal(reads, 0, "a valid snapshot does not read SQLite or settings");
      assert.equal(commits, 1, "no loading-effect commit on a warm switch");
      assert.equal(latest.loadedKeyRef.current, latest.slotKeyRef.current);
    }
    let ack!: Awaited<ReturnType<typeof write>>;
    await act(async () => {
      ack = await write(30_000, initial.fact.revision);
      latest.setState((old) => ({ ...old!, session: ack.session, facts: new Map(old!.facts).set(ack.fact.plannedSetId, ack.fact) }));
    });
    reads = 0;
    await act(async () => { renderer.update(element(slots[0]!)); });
    assert.equal(reads, 0, "the owner's ACK repopulates its snapshot");
    assert.equal(latest.state!.facts.get(ack.fact.plannedSetId)!.values.loadGrams, 30_000);
    await act(async () => { renderer.update(element(slots[1]!)); });
    assert.ok(reads > 0, "N+1 must reread Previous after the source week changes");
    assert.equal([...latest.previous.values()][0]!.values.loadGrams, 30_000);
    await act(async () => { renderer.update(element(slots[3]!)); });
    assert.equal(latest.state!.facts.size, 0, "another participant never borrows a cached execution");
    assert.equal(latest.previous.size, 0);
    await plans.setExerciseRest(a, program.id, exercise.id, 60);
    reads = 0;
    await act(async () => { renderer.update(element(slots[0]!)); });
    assert.ok(reads > 0);
    assert.equal(latest.workout!.exercises[0]!.restSec, 60);
    await act(async () => { latest.setMode("MANUAL"); });
    reads = 0;
    await act(async () => { renderer.update(element(slots[0]!)); });
    assert.equal(reads, 0); assert.equal(latest.mode, "MANUAL");
    await act(async () => { renderer.unmount(); });
  } finally { await execution.close(); await plans.close(); await clients.close(); }
});

test("PART-FLICKER-1: предзагруженный слот другого участника открывается одним кадром, без «переключения»", async () => {
  const db = new DatabaseSync(":memory:");
  const port = nodeSqlitePort(db);
  let reads = 0;
  const shared = new SharedSqliteDatabase(async () => ({ ...port,
    all: (sql, bindings) => { reads += 1; return port.all(sql, bindings); },
    first: (sql, bindings) => { reads += 1; return port.first(sql, bindings); } }));
  const clients = new DevClientRepository(shared, WS, []);
  const plans = new DevTrainingPlansRepository(shared, WS);
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await clients.initialize(); await plans.initialize(); await execution.initialize();
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    const a = (await clients.create({ displayName: "Synthetic A" })).id;
    const b = (await clients.create({ displayName: "Synthetic B" })).id;
    const firstWeek = [{ id: "workout", title: "Workout", exercises: [{ id: "exercise", exerciseId: "sys:synthetic:bench",
      restSec: 90, instruction: null, rir: null, sets: [{ id: "set", reps: 8, repsMax: null, loadGrams: null, durationSec: null, distanceM: null }] }] }];
    const program = await plans.createProgram({ title: "Synthetic", kind: "PERIODIZED", clientIds: [a, b] });
    await plans.createMesocycle(a, program.id, program.revision, { title: "Cycle", weeks: 2, firstWeek, clientIds: [a, b] });
    const slot = async (clientId: string, weekIndex: number): Promise<WorkoutSlot> => ({ clientId, programId: program.id, weekIndex,
      plannedWorkoutId: (await plans.getPeriodizedPlan(clientId, program.id))!.mesocycles[0]!.weeks[weekIndex - 1]!.workouts[0]!.id });
    const [a1, b1, b2] = await Promise.all([slot(a, 1), slot(b, 1), slot(b, 2)]);
    let latest!: ReturnType<typeof useWorkoutSnapshot>;
    let commits = 0;
    function Probe({ selected }: { selected: WorkoutSlot }) { latest = useWorkoutSnapshot(selected, plans, execution, 0); return null; }
    const element = (selected: WorkoutSlot) => createElement(Profiler, { id: "snapshot", onRender: () => { commits += 1; } },
      createElement(Probe, { selected }));
    await act(async () => { renderer = TestRenderer.create(element(a1)); });
    // Холодный переход (как сейчас): первый кадр показывает прежний снимок под новым слотом — экран «переключается».
    commits = 0;
    await act(async () => { renderer.update(element(b2)); });
    assert.ok(commits > 1, "без предзагрузки новый слот догружается отдельным кадром");
    await act(async () => { renderer.update(element(a1)); });
    let ready = false;
    await act(async () => { ready = await latest.preload(b1); });
    assert.equal(ready, true);
    reads = 0; commits = 0;
    await act(async () => { renderer.update(element(b1)); });
    assert.equal(commits, 1, "предзагруженный слот — один кадр, без промежуточного «переключения»");
    assert.equal(reads, 0, "переход не читает базу");
    assert.equal(latest.loadedKeyRef.current, latest.slotKeyRef.current);
    assert.equal(latest.displayedSlot.clientId, b);
    assert.equal(await latest.preload(b1), true, "повторная предзагрузка того же слота — из кэша");
    await act(async () => { renderer.unmount(); });
  } finally { await execution.close(); await plans.close(); await clients.close(); }
});

test("a new week's field is reconciled before commit, while pending edits of the same field are protected", async () => {
  let latest!: ReturnType<typeof useInputDraft>;
  const painted: string[] = [];
  function Probe({ identity, saved, pending }: { identity: string; saved: string; pending: boolean }) {
    latest = useInputDraft(identity, saved, pending); return null;
  }
  const element = (identity: string, saved: string, pending = false) => createElement(Profiler,
    { id: "field", onRender: () => { painted.push(latest.text); } }, createElement(Probe, { identity, saved, pending }));
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(element("week-1|same-set", "20")); });
  await act(async () => { latest.change("40"); renderer.update(element("week-1|same-set", "25", true)); });
  assert.equal(latest.text, "40");
  painted.length = 0;
  await act(async () => { renderer.update(element("week-2|same-set", "10", true)); });
  assert.deepEqual(painted, ["10"], "no commit paints week 1's text under week 2");
  await act(async () => { latest.change("invalid", true); });
  await act(async () => { renderer.update(element("week-2|same-set", "12")); });
  assert.equal(latest.text, "12"); assert.equal(latest.invalid, false);
  await act(async () => { renderer.unmount(); });
});

test("the idle navigation shortcut must not bypass failed writes or pending fields", async () => {
  const pending = new PendingInputWrites();
  const queue = new SerialWriteQueue();
  assert.equal(pending.dirty || queue.unsettled, false);
  pending.set("week-1|same-set:reps", async () => false);
  assert.equal(pending.dirty, true);
  assert.equal(await pending.flushAll(), false);
  assert.equal(pending.dirty, true);
  await queue.run(async () => { throw new Error("SYNTHETIC_WRITE_FAILURE"); });
  assert.equal(queue.busy, false); assert.equal(queue.unsettled, true);
  assert.equal(await queue.settle(), false); assert.equal(queue.unsettled, false);
});

test("cache is bounded and replacing repository owners cannot reuse another database's snapshot", async () => {
  let reads = 0;
  const owner = (label: string) => ({ subscribeCommittedChanges: () => () => undefined,
    findWorkout: async (_client: string, _program: string, _workout: string, week: number) => {
      reads += 1; return { workout: { id: "same-id", title: `${label}:${week}`, exercises: [] } };
    } }) as unknown as TrainingPlansRepositoryPort;
  const execution = { subscribeCommittedChanges: () => () => undefined, getConfirmationMode: async () => "AUTO",
    getWorkoutWithPrevious: async (_slot: unknown, queries: Promise<unknown>) => {
      await queries; return { current: { session: null, facts: new Map(), notes: new Map() }, previous: new Map() };
    } } as unknown as TrainingExecutionPort;
  const first = owner("first"), second = owner("second");
  let latest!: ReturnType<typeof useWorkoutSnapshot>;
  function Probe({ week, repository }: { week: number; repository: TrainingPlansRepositoryPort }) {
    latest = useWorkoutSnapshot({ clientId: "client", programId: "program", weekIndex: week, plannedWorkoutId: "same-id" }, repository, execution, 0); return null;
  }
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(createElement(Probe, { week: 1, repository: first })); });
  for (let week = 2; week <= 14; week += 1) await act(async () => { renderer.update(createElement(Probe, { week, repository: first })); });
  assert.equal(reads, 14);
  await act(async () => { renderer.update(createElement(Probe, { week: 14, repository: first })); });
  assert.equal(reads, 14);
  await act(async () => { renderer.update(createElement(Probe, { week: 1, repository: first })); });
  assert.equal(reads, 15, "oldest snapshot is evicted instead of growing without a bound");
  await act(async () => { renderer.update(createElement(Probe, { week: 1, repository: second })); });
  assert.equal(reads, 16); assert.equal(latest.workout!.title, "second:1");
  await act(async () => { renderer.unmount(); });
});

test("INPUT-LAG-1 коммит собственной записи не вытесняет показанный слот из кэша (между публикацией и ACK ввод не закрывается)", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, []);
  const plans = new DevTrainingPlansRepository(shared, WS);
  const execution = new DevTrainingExecutionRepository(shared, WS);
  await clients.initialize(); await plans.initialize(); await execution.initialize();
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    const a = (await clients.create({ displayName: "Synthetic A" })).id;
    const firstWeek = [{ id: "workout", title: "Workout", exercises: [{ id: "exercise", exerciseId: "sys:synthetic:bench",
      restSec: 90, instruction: null, rir: null, sets: [{ id: "set", reps: 8, repsMax: null, loadGrams: null, durationSec: null, distanceM: null }] }] }];
    const program = await plans.createProgram({ title: "Synthetic", kind: "PERIODIZED", clientIds: [a] });
    await plans.createMesocycle(a, program.id, program.revision, { title: "Cycle", weeks: 2, firstWeek, clientIds: [a] });
    const slot: WorkoutSlot = { clientId: a, programId: program.id, weekIndex: 1,
      plannedWorkoutId: (await plans.getPeriodizedPlan(a, program.id))!.mesocycles[0]!.weeks[0]!.workouts[0]!.id };
    const exercise = (await plans.findWorkout(a, program.id, slot.plannedWorkoutId, 1))!.workout.exercises[0]!;
    let latest!: ReturnType<typeof useWorkoutSnapshot>;
    let finds = 0;
    const counted: TrainingPlansRepositoryPort = new Proxy(plans, { get: (target, key) => {
      const value: unknown = Reflect.get(target, key, target);
      if (key !== "findWorkout" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      return (...args: unknown[]) => { finds += 1; return (value as (...rest: unknown[]) => unknown).apply(target, args); };
    } });
    // Любой подписчик на коммиты, который перерисовывает дерево синхронно (как useSyncExternalStore), оказывается между публикацией и ACK.
    function Probe() { latest = useWorkoutSnapshot(slot, counted, execution, 0); return null; }
    await act(async () => { renderer = TestRenderer.create(createElement(Probe)); });
    assert.equal(finds, 1);
    let insideCommit = false;
    // Коммит записи публикуется до того, как ACK дойдёт до дневника: в этот момент слот обязан оставаться загруженным.
    const off = execution.subscribeCommittedChanges(() => { insideCommit = latest.isCached(slot); });
    await execution.saveSet({ slot, plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId,
      plannedSetId: exercise.sets[0]!.id, position: 0, metrics: ["load", "reps"],
      values: { reps: 8, loadGrams: 20_000, durationSec: null, distanceM: null }, setType: "NORMAL", drops: [], rpe: null, expectedRevision: null });
    off();
    assert.equal(insideCommit, true, "показанный слот не вытеснен коммитом собственной записи");
    assert.equal(finds, 1, "собственная запись не перечитывает слот");
    await act(async () => { renderer.unmount(); });
  } finally { await execution.close(); await plans.close(); await clients.close(); }
});
