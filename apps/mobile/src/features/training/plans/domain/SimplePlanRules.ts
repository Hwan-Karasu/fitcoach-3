import { normalizeTitle } from "./ProgramRules.ts";
import { REST_MAX_SEC, REST_MIN_SEC, WEEKS_MAX, WEEKS_MIN, type PlannedExercise, type PlannedSet, type SimpleProgramDraft } from "./SimplePlanModel.ts";

/** §33.2 Величины подхода (тот же контракт, что у каталога упражнений; профиль упражнения даёт каталог). */
export type TrackingMetric = "reps" | "load" | "addedLoad" | "assistance" | "duration" | "distance";

/** Какие поля планового подхода заполняет профиль упражнения (§33.2). */
export type SetField = "reps" | "loadGrams" | "durationSec" | "distanceM";

export function setFieldsOf(metrics: readonly TrackingMetric[]): readonly SetField[] {
  return metrics.map((metric): SetField => metric === "reps" ? "reps" : metric === "duration" ? "durationSec"
    : metric === "distance" ? "distanceM" : "loadGrams");
}

export const SET_LIMITS: Readonly<Record<SetField, Readonly<{ min: number; max: number }>>> = {
  reps: { min: 1, max: 999 },
  loadGrams: { min: 0, max: 1_000_000 },
  durationSec: { min: 1, max: 86_400 },
  distanceM: { min: 1, max: 1_000_000 },
};

export interface PlanIssue {
  readonly workoutId: string | null;
  readonly exerciseId: string | null;
  readonly message: string;
}

/**
 * Проверка перед сохранением: название, недели 1–52, хотя бы одна тренировка с названием, у каждого
 * упражнения хотя бы один подход, значения в пределах. Пустое плановое значение допустимо — тренер может
 * заполнить его позже; лишние для профиля поля должны быть пустыми.
 */
export function validateDraft(draft: SimpleProgramDraft,
  metricsOf: (exerciseId: string) => readonly TrackingMetric[] | null): readonly PlanIssue[] {
  const issues: PlanIssue[] = [];
  try { normalizeTitle(draft.title); } catch { issues.push({ workoutId: null, exerciseId: null, message: "Введите название программы." }); }
  const { weeks, workouts } = draft.plan;
  if (!Number.isInteger(weeks) || weeks < WEEKS_MIN || weeks > WEEKS_MAX) {
    issues.push({ workoutId: null, exerciseId: null, message: `Недель — от ${WEEKS_MIN} до ${WEEKS_MAX}.` });
  }
  if (workouts.length === 0) issues.push({ workoutId: null, exerciseId: null, message: "Добавьте хотя бы одну тренировку." });
  const ids = new Set<string>();
  const unique = (id: string) => { if (ids.has(id)) issues.push({ workoutId: null, exerciseId: null, message: "Повторяющийся ID в структуре." }); ids.add(id); };
  for (const workout of workouts) {
    unique(workout.id);
    if (!workout.title.trim()) issues.push({ workoutId: workout.id, exerciseId: null, message: "У тренировки нет названия." });
    for (const exercise of workout.exercises) {
      unique(exercise.id);
      const metrics = metricsOf(exercise.exerciseId);
      if (metrics === null) {
        issues.push({ workoutId: workout.id, exerciseId: exercise.id, message: "Упражнение не найдено в каталоге." });
        continue;
      }
      if (exercise.sets.length === 0) issues.push({ workoutId: workout.id, exerciseId: exercise.id, message: "Нужен хотя бы один подход." });
      if (exercise.restSec !== null && (!Number.isInteger(exercise.restSec) || exercise.restSec < REST_MIN_SEC
        || exercise.restSec > REST_MAX_SEC)) {
        issues.push({ workoutId: workout.id, exerciseId: exercise.id, message: "Отдых — от 15 секунд до 15 минут." });
      }
      const allowed = new Set(setFieldsOf(metrics));
      for (const set of exercise.sets) {
        unique(set.id);
        for (const field of Object.keys(SET_LIMITS) as SetField[]) {
          const value = set[field];
          if (value === null) continue;
          if (!allowed.has(field)) issues.push({ workoutId: workout.id, exerciseId: exercise.id, message: "Лишнее значение для этого упражнения." });
          const limit = SET_LIMITS[field];
          if (!Number.isInteger(value) || value < limit.min || value > limit.max) {
            issues.push({ workoutId: workout.id, exerciseId: exercise.id, message: "Значение подхода вне допустимого диапазона." });
          }
        }
      }
    }
  }
  return issues;
}

/** Вес из ввода «62,5» → граммы; пусто → null; неверно → "invalid". Шаг — 10 г. */
export function parseLoad(text: string): number | null | "invalid" {
  const value = text.trim().replace(",", ".");
  if (value === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return "invalid";
  return Math.round(Number(value) * 100) * 10;
}

export function formatLoad(grams: number): string {
  return `${(grams / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} кг`;
}

/** Время из «1:30» или «90» (секунды) → секунды. */
export function parseDuration(text: string): number | null | "invalid" {
  const value = text.trim();
  if (value === "") return null;
  const parts = value.split(":");
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return "invalid";
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} км` : `${meters} м`;
}

function setsWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} подходов`;
  if (count % 10 === 1) return `${count} подход`;
  return count % 10 >= 2 && count % 10 <= 4 ? `${count} подхода` : `${count} подходов`;
}

function describeSet(set: PlannedSet): string {
  return [set.loadGrams !== null ? formatLoad(set.loadGrams) : null, set.reps !== null ? `${set.reps}` : null,
    set.durationSec !== null ? formatDuration(set.durationSec) : null, set.distanceM !== null ? formatDistance(set.distanceM) : null]
    .filter((part) => part !== null).join(" × ");
}

/** Кратко для строки упражнения: «3 × 10 · 60 кг» при одинаковых подходах, иначе «3 подхода». */
export function setsSummary(exercise: PlannedExercise): string {
  const { sets } = exercise;
  if (sets.length === 0) return "нет подходов";
  const first = sets[0] as PlannedSet;
  const same = sets.every((set) => set.reps === first.reps && set.loadGrams === first.loadGrams
    && set.durationSec === first.durationSec && set.distanceM === first.distanceM);
  const value = describeSet(first);
  if (!same || value === "") return setsWord(sets.length);
  return `${sets.length} × ${value}`;
}
