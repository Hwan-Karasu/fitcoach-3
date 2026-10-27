import assert from "node:assert/strict";
import test from "node:test";
import { assertValidTransfer } from "../apps/mobile/src/features/import/domain/TransferValidation.ts";
import { reidTransfer, transferSourceIds } from "../apps/mobile/src/features/import/domain/TransferIds.ts";
import type { TrainingTransfer, TransferCycle, TransferWorkout } from "../apps/mobile/src/shared/training-transfer/TrainingTransfer.ts";
import { trainingTransferFixture } from "./training-transfer-fixture.ts";

const clone = <T>(value: T): T => structuredClone(value);
const firstCycle = (value: TrainingTransfer): TransferCycle => value.programs[0]!.mesocycles[0]!;
const firstWorkout = (value: TrainingTransfer): TransferWorkout => firstCycle(value).weeks[0]!.workouts[0]!;

test("a consistent transfer passes validation", () => {
  assert.doesNotThrow(() => assertValidTransfer(trainingTransferFixture()));
});

const broken: ReadonlyArray<Readonly<{ rule: string; message: RegExp; mutate: (value: TrainingTransfer) => TrainingTransfer }>> = [
  { rule: "duplicate workout id in a week", message: /Повтор идентификатора тренировки/, mutate: (v) => { const w = firstWorkout(v); (firstCycle(v).weeks[0]!.workouts as TransferWorkout[]).push(clone(w)); return v; } },
  { rule: "duplicate planned exercise id in a workout", message: /Повтор идентификатора упражнения плана/, mutate: (v) => { const w = firstWorkout(v); (w.exercises as unknown[]).push(clone(w.exercises[0])); return v; } },
  { rule: "duplicate planned set id in an exercise", message: /Повтор идентификатора планового подхода/, mutate: (v) => { const e = firstWorkout(v).exercises[0]!; (e.sets as unknown[]).push(clone(e.sets[0])); return v; } },
  { rule: "planned exercise missing from the catalogue", message: /Упражнение плана отсутствует в справочнике/, mutate: (v) => { (firstWorkout(v).exercises[0] as { exerciseId: string }).exerciseId = "unknown"; return v; } },
  { rule: "repetition range upper bound below lower bound", message: /Неверный диапазон плановых повторений/, mutate: (v) => { const s = firstWorkout(v).exercises[0]!.sets[0] as { reps: number; repsMax: number }; s.reps = 10; s.repsMax = 8; return v; } },
  { rule: "repetitions above 999", message: /Недопустимое значение reps/, mutate: (v) => { (firstWorkout(v).exercises[0]!.sets[0] as { reps: number }).reps = 1000; return v; } },
  { rule: "non-integer load", message: /Недопустимое значение loadGrams/, mutate: (v) => { (firstWorkout(v).exercises[0]!.sets[0] as { loadGrams: number }).loadGrams = 62.5; return v; } },
  { rule: "instruction longer than 500 characters", message: /Плановое указание к упражнению превышает 500 символов/, mutate: (v) => { (firstWorkout(v).exercises[0] as { instruction: string }).instruction = "я".repeat(501); return v; } },
  { rule: "repeated week index in a cycle", message: /Повтор недели мезоцикла/, mutate: (v) => { (firstCycle(v).weeks[1] as { index: number }).index = 1; return v; } },
  { rule: "empty programme title", message: /Название программы должно содержать от 1 до 80 символов/, mutate: (v) => { (v.programs[0] as { title: string }).title = "  "; return v; } },
  { rule: "programme title over 80 characters", message: /Название программы должно содержать от 1 до 80 символов/, mutate: (v) => { (v.programs[0] as { title: string }).title = "я".repeat(81); return v; } },
  { rule: "programme kind that contradicts its structure", message: /Тип программы не соответствует структуре/, mutate: (v) => { (v.programs[0] as { kind: string }).kind = "SIMPLE"; return v; } },
  { rule: "session of an unknown programme", message: /Неверная ссылка на программу или повтор занятия/, mutate: (v) => { (v.sessions[0] as { programId: string }).programId = "nowhere"; return v; } },
  { rule: "two sessions in one slot", message: /Неверная ссылка на программу или повтор занятия/, mutate: (v) => { (v.sessions as unknown[]).push({ ...clone(v.sessions[0]!), id: "another" }); return v; } },
  { rule: "result of an unknown exercise", message: /Неизвестное упражнение или повтор подхода в занятии/, mutate: (v) => { (v.sessions[0]!.facts[0] as { exerciseId: string }).exerciseId = "unknown"; return v; } },
  { rule: "result repeated for the same planned set", message: /Неизвестное упражнение или повтор подхода в занятии/, mutate: (v) => { const s = v.sessions[0]!; (s.facts as unknown[]).push({ ...clone(s.facts[0]!), id: "twin" }); return v; } },
  { rule: "drop set without drops", message: /Некорректный тип подхода или структура мини-сетов/, mutate: (v) => { (v.sessions[0]!.facts[0] as { setType: string }).setType = "DROP"; return v; } },
  { rule: "confirmed set without any result", message: /У выполненного подхода отсутствуют результаты/, mutate: (v) => { (v.sessions[0]!.facts[0] as { values: unknown }).values = { reps: null, loadGrams: null, durationSec: null, distanceM: null }; return v; } },
  { rule: "empty note", message: /Заметка к выполнению должна содержать от 1 до 1000 символов/, mutate: (v) => { (v.sessions[0] as { notes: unknown }).notes = [{ plannedExerciseId: "e1", text: " " }]; return v; } },
];
for (const { rule, message, mutate } of broken) {
  test(`validation rejects: ${rule}`, () => { assert.throws(() => assertValidTransfer(mutate(clone(trainingTransferFixture()))), message); });
}

const everyId = (value: TrainingTransfer): string[] => {
  const ids: string[] = []; const workouts = (items: readonly TransferWorkout[]) => items.forEach((w) => { ids.push(w.id); w.exercises.forEach((e) => { ids.push(e.id); e.sets.forEach((s) => ids.push(s.id)); }); });
  for (const p of value.programs) { ids.push(p.id); p.mesocycles.forEach((c) => { ids.push(c.id); c.weeks.forEach((w) => { ids.push(w.id); workouts(w.workouts); }); }); }
  for (const s of value.sessions) { ids.push(s.id); s.facts.forEach((f) => ids.push(f.id)); }
  return ids;
};
const sequential = (value: TrainingTransfer) => new Map(transferSourceIds(value).map((id, at) => [id, `new-${String(at).padStart(3, "0")}`]));
const mapping = { press: "target-press" };

test("every source id is listed once, in order of first appearance", () => {
  const value = trainingTransferFixture();
  const listed = transferSourceIds(value);
  assert.equal(new Set(listed).size, listed.length);
  for (const id of everyId(value)) assert.ok(listed.includes(id), id);
  assert.equal(listed[0], "program", "the programme comes first");
});

test("re-identifying gives every row a new id and keeps every relation", () => {
  const source = trainingTransferFixture(); const out = reidTransfer(source, "client-local", mapping, sequential(source));
  const before = new Set(transferSourceIds(source)); for (const id of everyId(out)) assert.ok(!before.has(id), `${id} is still a source id`);
  assert.equal(new Set(everyId(out)).size, everyId(out).length, "new ids are unique");
  const programId = out.programs[0]!.id;
  assert.ok(out.sessions.every((s) => s.programId === programId), "sessions point at the new programme");
  const workouts = new Map<string, TransferWorkout>(); firstCycle(out).weeks.forEach((w) => w.workouts.forEach((x) => workouts.set(x.id, x)));
  for (const session of out.sessions) {
    const workout = workouts.get(session.plannedWorkoutId); assert.ok(workout, "session points at a planned workout of the new plan");
    const sets = new Set(workout.exercises.flatMap((e) => e.sets.map((s) => s.id))); const exercises = new Set(workout.exercises.map((e) => e.id));
    for (const fact of session.facts) { assert.ok(sets.has(fact.plannedSetId)); assert.ok(exercises.has(fact.plannedExerciseId)); }
    for (const note of session.notes) assert.ok(exercises.has(note.plannedExerciseId));
  }
  assert.doesNotThrow(() => assertValidTransfer(out), "the result is still a consistent transfer");
});

test("re-identifying maps exercises, sets the client and does not touch the input", () => {
  const source = trainingTransferFixture(); const frozen = clone(source);
  const out = reidTransfer(source, "client-local", mapping, sequential(source));
  assert.equal(out.client.id, "client-local");
  assert.deepEqual(out.exercises.map((e) => e.id), ["target-press"]);
  assert.equal(firstWorkout(out).exercises[0]!.exerciseId, "target-press");
  assert.equal(out.sessions[0]!.facts[0]!.exerciseId, "target-press");
  assert.deepEqual(source, frozen);
});

test("a source id that appears in several places gets one new id", () => {
  const source = clone(trainingTransferFixture());
  const cycle = firstCycle(source); (source as { planHistory?: unknown }).planHistory = [{ id: "history", programId: "program", validFrom: "2026-10-01T00:00:00.000Z", validTo: "2026-10-02T00:00:00.000Z", simple: null, mesocycle: cycle }];
  const out = reidTransfer(source, "client-local", mapping, sequential(source));
  assert.equal(out.planHistory![0]!.mesocycle!.weeks[0]!.workouts[0]!.id, firstWorkout(out).id);
  assert.equal(out.planHistory![0]!.programId, out.programs[0]!.id);
});

test("an exercise without a chosen match stops the import with a clear message", () => {
  const source = trainingTransferFixture();
  assert.throws(() => reidTransfer(source, "client-local", {}, sequential(source)), /Сопоставьте все упражнения перед импортом/);
});

test("a missing new id is a programming error, not a silent reuse of the source id", () => {
  const source = trainingTransferFixture();
  assert.throws(() => reidTransfer(source, "client-local", mapping, new Map()), /Нет нового идентификатора/);
});
