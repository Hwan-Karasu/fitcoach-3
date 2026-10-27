import { arrayOf, id, integer, nullableInteger, nullableText, object, text } from "../../../../shared/domain/JsonShape.ts";
import { WEEK_TYPES, WEEK_SCOPES, type BuilderWeek, type Mesocycle } from "./PeriodizedModel.ts";
import type { MesocycleBuilderDraft, PeriodizedDraft } from "./PeriodizedDraft.ts";
import type { PlannedExercise, PlannedSet, PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";
import type { SimpleWorkoutDraft, SimpleWeek } from "./SimpleWorkoutEdit.ts";
import type { TemplateMesocycle, TemplatePayload } from "./TemplateModel.ts";
import { storedWorkbook } from "./StoredWorkbookShape.ts";

const strings = (value: unknown): value is string[] => arrayOf(value, text);
const range = (value: unknown): boolean => value === null || object(value) && integer(value.min) && nullableInteger(value.max);
const set = (value: unknown): value is PlannedSet => object(value) && id(value.id)
  && [value.reps, value.loadGrams, value.durationSec, value.distanceM].every(nullableInteger)
  && (value.repsMax === undefined || nullableInteger(value.repsMax));
const exercise = (value: unknown): value is PlannedExercise => object(value) && id(value.id) && id(value.exerciseId)
  && (value.restSec === undefined || nullableInteger(value.restSec)) && (value.instruction === undefined || nullableText(value.instruction))
  && (value.rir === undefined || range(value.rir)) && (value.lineageId === undefined || id(value.lineageId))
  && (value.supersetId === undefined || id(value.supersetId)) && arrayOf(value.sets, set);
export const storedWorkout = (value: unknown): value is PlannedWorkout => object(value) && id(value.id) && text(value.title)
  && (value.lineageId === undefined || id(value.lineageId)) && arrayOf(value.exercises, exercise);
const workouts = (value: unknown): value is PlannedWorkout[] => arrayOf(value, storedWorkout);
const weekType = (value: unknown): boolean => text(value) && WEEK_TYPES.some((type) => type === value);
const builderWeek = (value: unknown): value is BuilderWeek => object(value) && weekType(value.type) && workouts(value.workouts);
const week = (value: unknown): value is SimpleWeek => object(value) && integer(value.index) && value.index > 0 && workouts(value.workouts);
export const storedSimpleHistory = (value: unknown): value is { title: string; weeks: SimpleWeek[] } =>
  object(value) && text(value.title) && arrayOf(value.weeks, week);
export const storedSimpleDraft = (value: unknown): value is SimpleProgramDraft => object(value) && text(value.title) && object(value.plan)
  && integer(value.plan.weeks) && value.plan.weeks >= 1 && value.plan.weeks <= 52 && workouts(value.plan.workouts);
export type StoredBuilderDraft = SimpleProgramDraft | { envelope: 2; draft: SimpleProgramDraft; base: SimpleProgramDraft | null };
export const storedBuilderDraft = (value: unknown): value is StoredBuilderDraft => storedSimpleDraft(value)
  || object(value) && value.envelope === 2 && storedSimpleDraft(value.draft) && (value.base === null || storedSimpleDraft(value.base));
export const storedWorkoutDraft = (value: unknown): value is SimpleWorkoutDraft => object(value) && integer(value.baseRevision)
  && value.baseRevision > 0 && object(value.input) && integer(value.input.weekIndex) && id(value.input.workoutId)
  && storedWorkout(value.input.workout) && value.input.workout.id === value.input.workoutId
  && ["CURRENT", "FOLLOWING", "ALL"].includes(String(value.input.scope))
  && (value.input.replaceConflicts === undefined || strings(value.input.replaceConflicts))
  && (value.baseWorkout === undefined || storedWorkout(value.baseWorkout));
export const storedPeriodizedDraft = (value: unknown): value is PeriodizedDraft => object(value) && integer(value.baseRevision)
  && storedSimpleDraft(value.draft) && strings(value.clientIds) && (value.kind === "MESOCYCLE" || value.kind === "WEEK"
    && id(value.mesocycleId) && integer(value.weekIndex) && weekType(value.type) && WEEK_SCOPES.some((scope) => scope === value.scope)
    && (value.replaceConflicts === undefined || strings(value.replaceConflicts)) && (value.baseWorkouts === undefined || workouts(value.baseWorkouts)));
const storedPlacement = (value: unknown): value is import("./Placement.ts").Placement => object(value) && id(value.clientId)
  && object(value.target) && (value.target.kind === "join" || value.target.kind === "new"
    || value.target.kind === "program" && id(value.target.programId)
    || value.target.kind === "existing" && id(value.target.programId) && id(value.target.mesocycleId)
      && integer(value.target.expectedRevision) && nullableText(value.target.expectedGroupId)
      && (value.target.label === undefined || text(value.target.label))
      && (value.target.confirmReassignment === undefined || typeof value.target.confirmReassignment === "boolean"));
export const storedMesocycleBuilder = (value: unknown): value is MesocycleBuilderDraft => object(value) && nullableInteger(value.baseRevision)
  && text(value.programTitle) && text(value.title) && ["hypertrophy", "strength", "power", "endurance", "recomp", "custom"].includes(String(value.cycleType))
  && text(value.repsText) && text(value.startDate) && integer(value.editing) && strings(value.members) && arrayOf(value.weeks, builderWeek)
  && (value.baseWeeks === null || arrayOf(value.baseWeeks, builderWeek))
  && (value.placements === undefined || arrayOf(value.placements, storedPlacement))
  && (value.workbook === undefined || storedWorkbook(value.workbook, builderWeek));
export const storedMesocycle = (value: unknown): value is Mesocycle => object(value) && id(value.id) && id(value.lineageId) && text(value.title)
  && arrayOf(value.weeks, (item): item is Mesocycle["weeks"][number] => week(item) && object(item) && id(item.id) && weekType(item.type))
  && (value.repRange === undefined || range(value.repRange)) && (value.startDate === undefined || nullableText(value.startDate))
  && (value.cycleType === undefined || value.cycleType === null || ["hypertrophy", "strength", "power", "endurance", "recomp", "custom"].includes(String(value.cycleType)));
const templateMesocycle = (value: unknown): value is TemplateMesocycle => object(value) && text(value.title) && arrayOf(value.weeks, builderWeek);
export const storedTemplate = (value: unknown): value is TemplatePayload => object(value) && (
  value.kind === "SIMPLE" && integer(value.weeks) && value.weeks > 0 && workouts(value.workouts)
  || value.kind === "MESOCYCLE" && templateMesocycle(value.mesocycle)
  || value.kind === "PERIODIZED" && arrayOf(value.mesocycles, templateMesocycle));
