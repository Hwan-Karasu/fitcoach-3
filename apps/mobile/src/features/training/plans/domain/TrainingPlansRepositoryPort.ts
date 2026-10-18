import type { ClientProgramLibrary, CreateProgramInput, TrainingProgram } from "./ProgramModel.ts";
import type { NewMesocycleInput, PeriodizedPlan, WeekEditInput, WeekEditPreview, WeekEditResult } from "./PeriodizedModel.ts";
import type { PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";
import type { PeriodizedDraft } from "./PeriodizedDraft.ts";
import type { MesocycleVersion } from "./StructureVersion.ts";

export interface TrainingPlansCommittedChange {
  /** Клиенты, чья библиотека изменилась. */
  readonly clientIds: readonly string[];
}

export interface WorkoutWeekNavigation {
  readonly programTitle: string;
  readonly mesocycleId: string | null;
  readonly weeks: readonly Readonly<{ index: number; caption: string | null; workoutId: string | null }>[];
}

/**
 * Владелец планов тренировок (§§48.1–48.4, Feature 09). Типизированные ошибки: DRAFT_INVALID,
 * PARTICIPANT_CONFLICT, PROGRAM_REVISION_CONFLICT, TARGET_NOT_FOUND, PROGRAM_ARCHIVED.
 * Каждый запрос — в рамках одного клиента: чужие программы в библиотеку не попадают.
 */
export interface TrainingPlansRepositoryPort {
  getLibrary(clientId: string): Promise<ClientProgramLibrary>;
  getProgram(clientId: string, programId: string): Promise<TrainingProgram | null>;
  /** Новая программа выбранным клиентам; выбранная программа каждого из них не меняется. */
  createProgram(input: CreateProgramInput, now?: Date): Promise<TrainingProgram>;
  renameProgram(programId: string, expectedRevision: number, title: string, now?: Date): Promise<TrainingProgram>;
  /** Полный порядок действующих программ этого клиента; у других участников свой. Неполный список/повторы — DRAFT_INVALID. */
  reorderPrograms(clientId: string, programIds: readonly string[]): Promise<void>;
  /** Полный порядок мезоциклов активного участия клиента; выбор и содержимое не меняются. Неполный список/повторы — DRAFT_INVALID. */
  reorderMesocycles(clientId: string, programId: string, mesocycleIds: readonly string[]): Promise<void>;
  /** Открытая программа становится выбранной у этого клиента (не у остальных участников). */
  selectProgram(clientId: string, programId: string): Promise<void>;
  /** Архив участия клиента: у остальных участников программа остаётся. */
  archiveForClient(clientId: string, programId: string, now?: Date): Promise<void>;
  /** Возврат из архива не делает программу выбранной. */
  restoreForClient(clientId: string, programId: string): Promise<void>;
  /** Простая программа со структурой (только если клиент — её участник). */
  getSimplePlan(clientId: string, programId: string): Promise<Readonly<{ program: TrainingProgram; draft: SimpleProgramDraft }> | null>;
  /** Новая Простая программа клиенту вместе со структурой — одной транзакцией; черновик «новой» очищается. */
  createSimpleProgram(clientId: string, draft: SimpleProgramDraft, now?: Date): Promise<TrainingProgram>;
  /**
   * Сохранение конструктора: название и структура по ревизии (CAS). ID существующих строк сохраняются,
   * убранные удаляются, новые добавляются; черновик этой программы очищается в той же транзакции.
   */
  saveSimplePlan(clientId: string, programId: string, expectedRevision: number, draft: SimpleProgramDraft,
    now?: Date): Promise<TrainingProgram>;
  /**
   * §48.56: отдых одного упражнения программы (из дневника); `null` — таймер выключен. Это правка плана:
   * ревизия программы растёт, открытый конструктор со старой ревизией получит конфликт, а не затрёт её.
   */
  setExerciseRest(clientId: string, programId: string, plannedExerciseId: string, restSec: number | null,
    now?: Date): Promise<TrainingProgram>;
  /** Тренировка программы по ID — для дневника, в Простой и Расширенной программе одинаково. */
  findWorkout(clientId: string, programId: string, plannedWorkoutId: string):
    Promise<Readonly<{ program: TrainingProgram; workout: PlannedWorkout }> | null>;
  /** Тот же слот Простой / lineageId внутри текущего мезоцикла. Нет однозначного соответствия — null в неделе. */
  getWorkoutWeekNavigation(clientId: string, programId: string, plannedWorkoutId: string): Promise<WorkoutWeekNavigation | null>;
  /** Расширенная программа этого участника: его мезоциклы, недели и выбранный мезоцикл. */
  getPeriodizedPlan(clientId: string, programId: string): Promise<PeriodizedPlan | null>;
  /** Current first, then every immutable historical structure; another client's cycle returns no versions. */
  getMesocycleVersions(clientId: string, programId: string, mesocycleId: string): Promise<readonly MesocycleVersion[]>;
  /**
   * Новый мезоцикл (§48.12.1 п. 1): каждому выбранному участнику — своя копия с общим родством, одной
   * транзакцией по ревизии программы; открывшему клиенту он становится выбранным.
   */
  createMesocycle(clientId: string, programId: string, expectedRevision: number, input: NewMesocycleInput,
    now?: Date): Promise<Readonly<{ program: TrainingProgram; mesocycleId: string }>>;
  /**
   * Правка недели (§48.6): неделя открывшего клиента сохраняется как есть; та же разница по родству — в целевые
   * недели области у каждого выбранного участника. Одной транзакцией; факты не копируются.
   */
  saveWeek(clientId: string, programId: string, expectedRevision: number, input: WeekEditInput, now?: Date): Promise<WeekEditResult>;
  previewWeekEdit(clientId: string, programId: string, expectedRevision: number, input: WeekEditInput): Promise<WeekEditPreview>;
  /** §48.10: ручной выбор мезоцикла — только у этого клиента, хранится в базе; не правка плана. */
  selectMesocycle(clientId: string, programId: string, mesocycleId: string): Promise<void>;
  /** §48.29 Recovery Draft: ключ — `new:SIMPLE` или ID программы. Не публикует изменения в план. */
  getBuilderDraft(clientId: string, key: string): Promise<Readonly<{ baseRevision: number | null; draft: SimpleProgramDraft }> | null>;
  saveBuilderDraft(clientId: string, key: string, baseRevision: number | null, draft: SimpleProgramDraft): Promise<void>;
  clearBuilderDraft(clientId: string, key: string): Promise<void>;
  getPeriodizedDraft(clientId: string, programId: string, key: string): Promise<PeriodizedDraft | null>;
  savePeriodizedDraft(clientId: string, programId: string, draft: PeriodizedDraft): Promise<void>;
  clearPeriodizedDraft(clientId: string, programId: string, key: string): Promise<void>;
  subscribeCommittedChanges(listener: (change: TrainingPlansCommittedChange) => void): () => void;
}
