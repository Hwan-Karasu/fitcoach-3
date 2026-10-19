import type { PlannedSet, PlannedWorkout, WeekType } from "../../plans/public.ts";
import type { SetFact, SetValues } from "../domain/ExecutionModel.ts";
import type { SetField } from "../domain/ExecutionRules.ts";
import type { ProgramExecution } from "../domain/TrainingExecutionPort.ts";

/**
 * Матрица недель (T05, §48.5.3–48.5.4): строки — упражнения по тренировкам, колонки — недели. Строка — родство
 * упражнения вместе с самим упражнением: заменённое идёт отдельной строкой, а где его нет — прочерк; результат
 * старого упражнения не приписывается новому. Тоннаж — только засчитанные подходы (§48.44: предварительные
 * значения после копирования не считаются). Таблица как в 2.0 (UI-OWN-045): у подхода — план, «Пред.» (та же позиция
 * в последней предыдущей неделе с этим упражнением), повторы и вес отдельно и цель записи для правки прямо в матрице.
 */
/** Форматирование ячеек передаёт экран (setFormat): сборщик остаётся чистой функцией без зависимостей UI. */
export interface MatrixFormat {
  readonly plan: (set: PlannedSet, fields: readonly SetField[]) => string;
  readonly values: (values: SetValues, drops: readonly SetValues[], fields: readonly SetField[]) => string;
}

export interface MatrixWeek {
  readonly index: number;
  readonly caption: string | null;
  /** Тип недели Расширенной программы — цвет колонки (UI-OWN-038). */
  readonly type?: WeekType;
  readonly workouts: readonly PlannedWorkout[];
}

/** Куда записывать правку из матрицы: плановый подход обычного (не одностороннего) упражнения. */
export interface MatrixTarget {
  readonly plannedExerciseId: string;
  readonly exerciseId: string;
  readonly plannedSetId: string;
  readonly position: number;
  /** Записанный факт (его ревизия — для CAS); `null` — ещё не записан. */
  readonly fact: SetFact | null;
}

export interface MatrixSet {
  /** Номер планового подхода или «Р» у добавленной разминки. */
  readonly label: string;
  readonly plan: string;
  /** Введённое значение; `null` — ничего не введено. */
  readonly fact: string | null;
  /** «Пред.»: значение той же позиции в последней предыдущей неделе с этим упражнением. */
  readonly previous: string | null;
  readonly reps: number | null;
  readonly loadGrams: number | null;
  /** Какие величины есть у упражнения: правится только то, что оно считает (иначе INVALID_METRIC). */
  readonly hasReps: boolean;
  readonly hasLoad: boolean;
  readonly done: boolean;
  /** `null` — разминка или односторонний подход: в матрице только просмотр. */
  readonly target: MatrixTarget | null;
}

export interface MatrixCell {
  readonly workoutId: string;
  readonly sets: readonly MatrixSet[];
  readonly volumeKg: number;
}

export interface MatrixRow {
  readonly key: string;
  readonly exerciseId: string;
  readonly cells: ReadonlyMap<number, MatrixCell>;
}

export interface MatrixSection {
  readonly key: string;
  readonly title: string;
  readonly rows: readonly MatrixRow[];
  /** Объём тренировки по неделям, кг. */
  readonly totals: ReadonlyMap<number, number>;
}

export interface ProgramMatrix {
  readonly weeks: readonly Readonly<{ index: number; caption: string | null; type?: WeekType }>[];
  readonly sections: readonly MatrixSection[];
  /** Тоннаж недели, кг. */
  readonly totals: ReadonlyMap<number, number>;
}

const hasValue = (values: SetValues) => Object.values(values).some((value) => value !== null);

/** Тоннаж одного набора значений: вес × повторы, если оба введены. */
const tonnage = (values: SetValues) => values.loadGrams !== null && values.reps !== null ? values.loadGrams / 1000 * values.reps : 0;

function factText(fact: SetFact, fields: readonly SetField[], format: MatrixFormat): string | null {
  if (fact.sides !== null) {
    const { left, right } = fact.sides;
    if (!hasValue(left.values) && !hasValue(right.values)) return null;
    return `Л ${format.values(left.values, [], fields)} · П ${format.values(right.values, [], fields)}`;
  }
  return hasValue(fact.values) || fact.drops.some(hasValue) ? format.values(fact.values, fact.drops, fields) : null;
}

/** Тоннаж засчитанного подхода, кг: стороны — по засчитанной стороне, дроп-сеты входят. */
export function factVolume(fact: SetFact): number {
  if (!fact.confirmed) return 0;
  if (fact.sides !== null) {
    return (fact.sides.left.confirmed ? tonnage(fact.sides.left.values) : 0)
      + (fact.sides.right.confirmed ? tonnage(fact.sides.right.values) : 0);
  }
  return [fact.values, ...fact.drops].reduce((sum, values) => sum + tonnage(values), 0);
}

export function buildProgramMatrix(weeks: readonly MatrixWeek[], executions: readonly ProgramExecution[],
  fieldsOf: (exerciseId: string) => readonly SetField[], format: MatrixFormat): ProgramMatrix {
  const bySlot = new Map(executions.map((item) => [`${item.weekIndex}:${item.plannedWorkoutId}`, item.execution]));
  const sections = new Map<string, { title: string; totals: Map<number, number>;
    rows: Map<string, { exerciseId: string; cells: Map<number, MatrixCell> }> }>();
  const totals = new Map<number, number>();
  for (const week of weeks) {
    for (const workout of week.workouts) {
      const sectionKey = workout.lineageId ?? workout.id;
      const section = sections.get(sectionKey) ?? { title: workout.title, totals: new Map<number, number>(), rows: new Map() };
      sections.set(sectionKey, section);
      const execution = bySlot.get(`${week.index}:${workout.id}`);
      for (const exercise of workout.exercises) {
        const rowKey = `${sectionKey}/${exercise.lineageId ?? exercise.id}/${exercise.exerciseId}`;
        const row = section.rows.get(rowKey) ?? { exerciseId: exercise.exerciseId, cells: new Map<number, MatrixCell>() };
        section.rows.set(rowKey, row);
        const fields = fieldsOf(exercise.exerciseId);
        const facts = [...(execution?.facts.values() ?? [])].filter((fact) => fact.plannedExerciseId === exercise.id);
        const warmups = facts.filter((fact) => fact.extra).sort((a, b) => a.position - b.position);
        // «Пред.» — из последней предыдущей недели, где есть это упражнение (по номеру подхода).
        const hasReps = fields.includes("reps");
        const hasLoad = fields.includes("loadGrams");
        const before: MatrixCell | undefined = [...row.cells.values()].at(-1);
        const previousOf = (label: string) => before?.sets.find((item) => item.label === label)?.fact ?? null;
        const sets: MatrixSet[] = [
          ...warmups.map((fact): MatrixSet => ({ label: "Р", plan: "—", fact: factText(fact, fields, format), previous: null, hasReps, hasLoad,
            reps: null, loadGrams: null, done: fact.confirmed, target: null })),
          ...exercise.sets.map((set, index): MatrixSet => {
            const fact = execution?.facts.get(set.id);
            const label = String(index + 1);
            return { label, plan: format.plan(set, fields), fact: fact === undefined ? null : factText(fact, fields, format),
              previous: previousOf(label), reps: fact?.sides == null ? fact?.values.reps ?? null : null,
              loadGrams: fact?.sides == null ? fact?.values.loadGrams ?? null : null, hasReps, hasLoad, done: fact?.confirmed === true,
              target: fact?.sides != null ? null : { plannedExerciseId: exercise.id, exerciseId: exercise.exerciseId, plannedSetId: set.id,
                position: index, fact: fact ?? null } };
          }),
        ];
        const volumeKg = facts.reduce((sum, fact) => sum + factVolume(fact), 0);
        row.cells.set(week.index, { workoutId: workout.id, sets, volumeKg });
        section.totals.set(week.index, (section.totals.get(week.index) ?? 0) + volumeKg);
        totals.set(week.index, (totals.get(week.index) ?? 0) + volumeKg);
      }
    }
  }
  return {
    weeks: weeks.map((week) => ({ index: week.index, caption: week.caption, ...(week.type === undefined ? {} : { type: week.type }) })),
    sections: [...sections.entries()].map(([key, section]) => ({ key, title: section.title, totals: section.totals,
      rows: [...section.rows.entries()].map(([rowKey, row]) => ({ key: rowKey, exerciseId: row.exerciseId, cells: row.cells })) })),
    totals,
  };
}
