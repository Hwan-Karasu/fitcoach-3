import type { TrainingTransfer, TransferWorkout } from "../../../shared/training-transfer/TrainingTransfer.ts";

/**
 * Проверка модели переноса: уникальность и ссылки идентификаторов, диапазоны чисел, структура программы. Чистая функция над моделью:
 * её вызывают читатель файла и движок импорта, поэтому записи в БД не нужен круг через XLSX.
 */
export function assertValidTransfer(value: TrainingTransfer): void {
  const validateValues = (v: import("../../../shared/training-transfer/TrainingTransfer.ts").TransferValues) => {
    for (const [key, min, max] of [["reps", 1, 999], ["loadGrams", 0, 1000000], ["durationSec", 1, 86400], ["distanceM", 1, 1000000]] as const) {
      const n = v[key]; if (n !== null && (!Number.isSafeInteger(n) || n < min || n > max)) throw new Error(`Недопустимое значение ${key}. Проверьте числовые ячейки матрицы.`);
    }
  };
  const ids = new Set(value.programs.map((p) => p.id));
  const exercises = new Set(value.exercises.map((e) => e.id));
  const slots = new Set<string>();
  for (const s of value.sessions) {
    const key = JSON.stringify([s.programId, s.weekIndex, s.plannedWorkoutId]);
    if (!ids.has(s.programId) || slots.has(key)) throw new Error("Неверная ссылка на программу или повтор занятия в одном слоте.");
    slots.add(key);
    if (s.notes.some((n) => !n.text.trim() || n.text.length > 1000)) throw new Error("Заметка к выполнению должна содержать от 1 до 1000 символов.");
    const setIds = new Set<string>();
    for (const f of s.facts) {
      if (!exercises.has(f.exerciseId) || setIds.has(f.plannedSetId)) throw new Error("Неизвестное упражнение или повтор подхода в занятии."); setIds.add(f.plannedSetId);
      validateValues(f.values); f.drops.forEach(validateValues);
      if (f.sides) { validateValues(f.sides.left.values); validateValues(f.sides.right.values); }
      if (f.setType !== "DROP" && f.drops.length || f.extra && f.setType !== "WARMUP" || f.setType === "DROP" && !f.drops.length) throw new Error("Некорректный тип подхода или структура мини-сетов.");
      if (f.confirmed && !f.sides && Object.values(f.values).every((n) => n === null) && !value.issues?.some((i) => i.scope === "FACT" && i.targetId === f.id)) throw new Error("У выполненного подхода отсутствуют результаты.");
    }
  }
  const check = (items: readonly TransferWorkout[]) => { const workoutIds = new Set<string>(); for (const w of items) {
    if (workoutIds.has(w.id)) throw new Error("Повтор идентификатора тренировки."); workoutIds.add(w.id);
    const exerciseIds = new Set<string>(); for (const e of w.exercises) {
      if (exerciseIds.has(e.id)) throw new Error("Повтор идентификатора упражнения плана."); exerciseIds.add(e.id);
      if (!exercises.has(e.exerciseId)) throw new Error("Упражнение плана отсутствует в справочнике.");
      if (e.instruction !== null && e.instruction.length > 500) throw new Error("Плановое указание к упражнению превышает 500 символов.");
      const setIds = new Set<string>(); for (const s of e.sets) {
        if (setIds.has(s.id)) throw new Error("Повтор идентификатора планового подхода."); setIds.add(s.id); validateValues(s);
        if (s.repsMax !== null && (!Number.isSafeInteger(s.repsMax) || s.repsMax > 999 || s.reps === null || s.repsMax < s.reps)) throw new Error("Неверный диапазон плановых повторений.");
      }
    }
  } };
  for (const p of value.programs) {
    if (!p.title.trim() || p.title.length > 80) throw new Error("Название программы должно содержать от 1 до 80 символов.");
    if ((p.kind === "SIMPLE") !== (p.simple !== null) || p.simple && p.mesocycles.length) throw new Error("Тип программы не соответствует структуре.");
    if (p.simple) check(p.simple.workouts); for (const w of p.simpleWeeks) check(w.workouts);
    for (const c of p.mesocycles) { const weeks = new Set<number>(); for (const w of c.weeks) { if (weeks.has(w.index)) throw new Error("Повтор недели мезоцикла."); weeks.add(w.index); check(w.workouts); } }
  }
}
