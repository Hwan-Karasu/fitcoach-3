import { copyWeeks } from "./PeriodizedRules.ts";
import { independentWeeks } from "./PlanCopy.ts";
import type { Mesocycle, PlanWeek, WeekType } from "./PeriodizedModel.ts";
import type { PlannedWorkout } from "./SimplePlanModel.ts";

/**
 * Библиотека шаблонов (§48.14–48.16): одна на тренера, три типа — Простая программа, Расширенная программа,
 * мезоцикл. Шаблон хранит только план (недели, тренировки, упражнения, плановые подходы, типы недель,
 * суперсеты, указания, отдых); факты, даты, заметки о выполнении, версии и участники в него не входят.
 */
export type TemplateKind = "SIMPLE" | "PERIODIZED" | "MESOCYCLE";

export const templateKindLabels: Readonly<Record<TemplateKind, string>> = {
  SIMPLE: "Простая программа", PERIODIZED: "Расширенная программа", MESOCYCLE: "Мезоцикл",
};

export interface TemplateWeek {
  readonly type: WeekType;
  readonly workouts: readonly PlannedWorkout[];
}

export interface TemplateMesocycle {
  readonly title: string;
  readonly weeks: readonly TemplateWeek[];
}

export type TemplatePayload =
  | Readonly<{ kind: "SIMPLE"; weeks: number; workouts: readonly PlannedWorkout[] }>
  | Readonly<{ kind: "PERIODIZED"; mesocycles: readonly TemplateMesocycle[] }>
  | Readonly<{ kind: "MESOCYCLE"; mesocycle: TemplateMesocycle }>;

export interface ProgramTemplate {
  readonly id: string;
  readonly kind: TemplateKind;
  readonly title: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly payload: TemplatePayload;
}

/** Мезоцикл плана → снимок шаблона: только порядок недель, их типы и план. */
export function templateMesocycle(mesocycle: Pick<Mesocycle, "title" | "weeks">): TemplateMesocycle {
  return { title: mesocycle.title, weeks: mesocycle.weeks.map((week) => ({ type: week.type, workouts: week.workouts })) };
}

/** Мезоцикл шаблона → недели нового мезоцикла: новые ID и новое родство (независимая копия, §48.14.1 п. 6). */
export function weeksFromTemplate(mesocycle: TemplateMesocycle, newId: () => string): readonly PlanWeek[] {
  return independentWeeks(mesocycle.weeks.map((week, index) => ({ id: `t${index}`, index: index + 1, type: week.type,
    workouts: week.workouts })), newId);
}

/** Тренировки Простого шаблона → новые ID; родство Простой программе не нужно. */
export function workoutsFromTemplate(workouts: readonly PlannedWorkout[], newId: () => string): readonly PlannedWorkout[] {
  const [week] = copyWeeks([{ id: "t", index: 1, type: "base", workouts }], newId);
  return (week?.workouts ?? []).map(({ lineageId: workoutLineage, ...workout }) => {
    void workoutLineage;
    return { ...workout, exercises: workout.exercises.map(({ lineageId: exerciseLineage, ...exercise }) => {
      void exerciseLineage;
      return exercise;
    }) };
  });
}

/** Мезоциклы шаблона как циклы конструктора: Расширенная — все по порядку, Мезоцикл — один, Простая — нет. */
export function templateCycles(payload: TemplatePayload): readonly TemplateMesocycle[] {
  return payload.kind === "MESOCYCLE" ? [payload.mesocycle] : payload.kind === "PERIODIZED" ? payload.mesocycles : [];
}

/**
 * Циклы шаблона как циклы конструктора (вкладки «Циклы программы»): у каждого цикла, тренировки, упражнения и подхода — новый ID, поэтому
 * правка добавленного цикла не трогает шаблон, а удаление шаблона — цикл. Порядок и типы недель — как в шаблоне. Фактов в шаблоне нет.
 */
export function templateBuilderCycles(payload: TemplatePayload, newKey: () => string, newId: () => string):
  readonly Readonly<{ key: string; title: string; weeks: readonly Readonly<{ type: PlanWeek["type"]; workouts: readonly PlannedWorkout[] }>[] }>[] {
  return templateCycles(payload).map((cycle) => ({ key: newKey(), title: cycle.title,
    weeks: weeksFromTemplate(cycle, newId).map((week) => ({ type: week.type, workouts: week.workouts })) }));
}

/**
 * Из шаблона создаётся новая программа (открывается конструктор новой программы): Простая и Расширенная. Из шаблона цикла — никогда:
 * он только добавляется в существующую программу (решение владельца 2026-10-29; раньше его открывали в конструкторе новой программы,
 * и вместо цикла появлялась программа). Вид определяется типом шаблона, а не числом циклов или названием.
 */
export function templateCreatesProgram(payload: TemplatePayload): boolean {
  return payload.kind === "SIMPLE" || (payload.kind === "PERIODIZED" && payload.mesocycles.length > 0);
}

/** Циклы шаблона можно добавить в существующую Расширенную программу: шаблон цикла и циклы Расширенной; Простая — не цикл (§48.14.2 п. 4). */
export function templateAddsCycles(payload: TemplatePayload): boolean {
  return templateCycles(payload).length > 0;
}

/** Короткое описание для карточки библиотеки. */
export function templateSummary(payload: TemplatePayload): string {
  const weeksWord = (count: number) => `${count} нед.`;
  if (payload.kind === "SIMPLE") return `${weeksWord(payload.weeks)} · тренировок: ${payload.workouts.length}`;
  if (payload.kind === "MESOCYCLE") {
    return `${weeksWord(payload.mesocycle.weeks.length)} · тренировок в неделе: ${payload.mesocycle.weeks[0]?.workouts.length ?? 0}`;
  }
  return `мезоциклов: ${payload.mesocycles.length} · ${weeksWord(payload.mesocycles.reduce((sum, cycle) => sum + cycle.weeks.length, 0))}`;
}
