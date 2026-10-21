import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { act, createElement } from "react";
import TestRenderer from "react-test-renderer";
import { DevClientRepository } from "../src/features/clients/data/DevClientRepository.ts";
import { DevTrainingPlansRepository, devTrainingPlansClientDeletionParticipant } from
  "../src/features/training/plans/data/DevTrainingPlansRepository.ts";
import type { ExerciseLookupPort } from "../src/features/training/plans/domain/ExerciseLookupPort.ts";
import { addExercise, fillSets, newDraft } from "../src/features/training/plans/domain/SimplePlanEdits.ts";
import { useExerciseLookupState } from "../src/features/training/plans/presentation/useExerciseLookup.ts";
import { SharedSqliteDatabase } from "../src/shared/db/SharedSqliteDatabase.ts";
import { nodeSqlitePort } from "../../../scripts/support/node-sqlite-port.ts";

// Хуки состояния модуля «Тренировки» (react-test-renderer, как у питания): отказы чтения и подписки на изменения.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WS = "synthetic-workspace-a";
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

test("TRN-013 справочник упражнений: отказ чтения — failed с повтором, а не вечная загрузка", async () => {
  let fail = true;
  const port: ExerciseLookupPort = {
    lookup: async () => { if (fail) throw new Error("DB_UNAVAILABLE"); return new Map(); },
    subscribe: () => () => undefined,
  };
  const frames: { lookup: unknown; failed: boolean; retry: () => void }[] = [];
  function Probe() {
    const state = useExerciseLookupState(port);
    frames.push(state);
    return null;
  }
  await act(async () => { TestRenderer.create(createElement(Probe)); });
  await settle();
  assert.equal(frames.at(-1)!.lookup, null);
  assert.equal(frames.at(-1)!.failed, true, "ошибка видна экрану");
  fail = false;
  await act(async () => { frames.at(-1)!.retry(); });
  await settle();
  assert.notEqual(frames.at(-1)!.lookup, null, "после повтора справочник загружен");
  assert.equal(frames.at(-1)!.failed, false);
});

test("TRN-012 перестановка мезоциклов оповещает как «только порядок» (экран программы не перезагружается), история обновляется", async () => {
  const db = new DatabaseSync(":memory:");
  const shared = new SharedSqliteDatabase(async () => nodeSqlitePort(db));
  const clients = new DevClientRepository(shared, WS, [devTrainingPlansClientDeletionParticipant]);
  await clients.initialize();
  const plans = new DevTrainingPlansRepository(shared, WS);
  await plans.initialize();
  try {
    const a = (await clients.create({ displayName: "SyntheticA" })).id;
    let n = 0;
    const firstWeek = fillSets(addExercise(newDraft("w1"), "w1", "e1", "sys:repdb:bench", () => `s${n++}`), "e1", "reps", 10).plan.workouts;
    const program = await plans.createProgram({ kind: "PERIODIZED", title: "Порядок", clientIds: [a] });
    const first = await plans.createMesocycle(a, program.id, program.revision, { title: "Один", weeks: 2, firstWeek, clientIds: [a] });
    const revision = (await plans.getProgram(a, program.id))!.revision;
    const second = await plans.createMesocycle(a, program.id, revision, { title: "Два", weeks: 2, firstWeek: firstWeek.map((workout) => ({ ...workout,
      id: "x-w", exercises: workout.exercises.map((exercise) => ({ ...exercise, id: "x-e", sets: exercise.sets.map((set, at) => ({ ...set, id: `x-s${at}` })) })) })),
    clientIds: [a] });
    const seen: unknown[] = [];
    const off = plans.subscribeCommittedChanges((change) => { seen.push(change); });
    await plans.reorderMesocycles(a, program.id, [second.mesocycleId, first.mesocycleId]);
    off();
    assert.deepEqual(seen, [{ clientIds: [a], orderOnly: true }]);
    assert.deepEqual((await plans.getPeriodizedPlan(a, program.id))!.mesocycles.map((cycle) => cycle.title), ["Два", "Один"]);
  } finally { await plans.close(); await clients.close(); }
});
