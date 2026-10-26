import type { TrainingTransfer, TransferWorkout } from "../apps/mobile/src/shared/training-transfer/TrainingTransfer.ts";
const workout = (week: number): TransferWorkout => ({ id: `w${week}`, lineageId: "workout", title: "Тренировка 1", exercises: [{ id: `e${week}`, lineageId: "exercise", exerciseId: "press", restSec: 90, instruction: "Плавно", rir: { min: 1, max: 2 }, sets: [
  { id: `s${week}`, reps: 8, repsMax: 10, loadGrams: 62500, durationSec: null, distanceM: null },
  { id: `s${week}b`, reps: 8, repsMax: 10, loadGrams: null, durationSec: null, distanceM: null },
] }] });
export function trainingTransferFixture(): TrainingTransfer { return {
  format: "athlete-training", version: 1, sourceId: "synthetic-test", client: { id: "client", name: "Пример клиента" }, exercises: [{ id: "press", name: "Жим штанги лёжа" }],
  programs: [{ id: "program", title: "Программа силы", kind: "PERIODIZED", createdAt: "2026-10-01T00:00:00.000Z", archivedAt: null, simple: null, simpleWeeks: [], mesocycles: [{ id: "cycle", lineageId: "cycle", title: "Первый мезоцикл", cycleType: null, repRange: null, startDate: null, weeks: [1, 2, 3].map((index) => ({ id: `week${index}`, index, type: "base", workouts: [workout(index)] })) }] }],
  sessions: [1, 2].map((week) => ({ id: `session${week}`, programId: "program", weekIndex: week, plannedWorkoutId: `w${week}`, actualDate: "2026-10-20", outcome: null, startedAt: null, finishedAt: null, origin: null, notes: [{ plannedExerciseId: `e${week}`, text: "Без боли" }], facts: [{ id: `fact${week}`, plannedSetId: `s${week}`, plannedExerciseId: `e${week}`, exerciseId: "press", position: 0, setType: "NORMAL", values: { reps: week === 1 ? 8 : 10, loadGrams: 62500, durationSec: null, distanceM: null }, drops: [], sides: null, rpe: 8, confirmed: true, extra: false, origin: "INPUT", revision: 1 }] })),
}; }
