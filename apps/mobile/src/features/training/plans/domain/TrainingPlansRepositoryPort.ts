import type { ClientProgramLibrary, CreateProgramInput, TrainingProgram } from "./ProgramModel.ts";
import type { ProgramTemplate, TemplatePayload } from "./TemplateModel.ts";
import type { BuilderMesocycleInput, NewMesocycleInput, NewPeriodizedProgramInput, PeriodizedPlan, WeekEditInput, WeekEditPreview, WeekEditResult } from "./PeriodizedModel.ts";
import type { PlannedWorkout, SimpleProgramDraft } from "./SimplePlanModel.ts";
import type { PeriodizedDraft } from "./PeriodizedDraft.ts";
import type { MesocycleVersion } from "./StructureVersion.ts";
import type { SimplePlanVersion, SimpleWeek, SimpleWorkoutDraft, SimpleWorkoutEdit } from "./SimpleWorkoutEdit.ts";
import type { CopyMesocycleInput } from "./PlanCopy.ts";

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
  /**
   * UI-OWN-038: Расширенная программа сразу с первым мезоциклом — одной транзакцией. Пустые недели получают план
   * ближайшей заполненной (защита от мисклика); всё пусто или неверные настройки — DRAFT_INVALID, ничего не пишется.
   */
  createPeriodizedProgram(input: NewPeriodizedProgramInput, now?: Date): Promise<TrainingProgram>;
  /** «В шаблон» конструктора Расширенной программы: черновик — шаблон программы из одного мезоцикла; программа не создаётся. */
  saveBuilderAsTemplate(input: Readonly<{ title: string; mesocycle: BuilderMesocycleInput }>, now?: Date): Promise<ProgramTemplate>;
  renameProgram(programId: string, expectedRevision: number, title: string, now?: Date): Promise<TrainingProgram>;
  /** §48.16: библиотека шаблонов тренера (все типы); новые сверху. */
  listTemplates(): Promise<readonly ProgramTemplate[]>;
  /**
   * §48.14–48.15: план открытой программы этого клиента — шаблон Простой или Расширенной программы (у общей
   * программы — мезоциклы именно этого участника). Только план; программа и факты не меняются.
   */
  saveProgramAsTemplate(clientId: string, programId: string, title: string, now?: Date): Promise<ProgramTemplate>;
  /**
   * «В шаблон» Простого конструктора (UI-OWN-026, как в 2.0): несохранённый черновик — шаблон Простой программы
   * с его названием. Программа не создаётся и не меняется; структура проверяется как у плана (DRAFT_INVALID).
   */
  saveSimpleDraftAsTemplate(draft: SimpleProgramDraft, now?: Date): Promise<ProgramTemplate>;
  /** §48.14.1 п. 1: один мезоцикл этого клиента как шаблон мезоцикла. */
  saveMesocycleAsTemplate(clientId: string, programId: string, mesocycleId: string, title: string, now?: Date): Promise<ProgramTemplate>;
  renameTemplate(templateId: string, expectedRevision: number, title: string, now?: Date): Promise<ProgramTemplate>;
  /** Шаблон по ID (открыть для просмотра и правки). */
  getTemplate(templateId: string): Promise<ProgramTemplate | null>;
  /**
   * §48.16 п. 3: правка содержимого шаблона (тип не меняется) по ревизии. Программы, созданные по нему раньше,
   * не меняются (§48.16 п. 4).
   */
  updateTemplate(templateId: string, expectedRevision: number, title: string, payload: TemplatePayload, now?: Date): Promise<ProgramTemplate>;
  /** Независимая копия шаблона (§48.16 п. 3). */
  duplicateTemplate(templateId: string, title: string, now?: Date): Promise<ProgramTemplate>;
  /**
   * §48.13.1 п. 8, §48.14.2 п. 2: новый мезоцикл в открытой программе из шаблона мезоцикла или одного мезоцикла
   * (`mesocycleIndex`) шаблона Расширенной программы. Выбранным участникам — свои копии; новые ID и родство.
   */
  createMesocycleFromTemplate(clientId: string, programId: string, expectedRevision: number,
    input: Readonly<{ templateId: string; mesocycleIndex: number; title: string; clientIds: readonly string[] }>,
    now?: Date): Promise<Readonly<{ program: TrainingProgram; mesocycleId: string }>>;
  /**
   * §48.17: новая Расширенная программа на основе Простой этого клиента — её текущий план по неделям становится
   * первым мезоциклом (у каждого участника своя копия). Простая не меняется, факты не переносятся.
   */
  createPeriodizedFromSimple(clientId: string, simpleProgramId: string,
    input: Readonly<{ title: string; mesocycleTitle: string; clientIds: readonly string[] }>, now?: Date): Promise<TrainingProgram>;
  /** Удаление шаблона не трогает программы, созданные по нему (§48.16 п. 4). */
  deleteTemplate(templateId: string): Promise<void>;
  /**
   * §48.14.2 п. 1, 3: новая программа из шаблона Простой (один клиент) или Расширенной (выбранные участники,
   * у каждого своя копия) программы — новые ID, без фактов; одной транзакцией.
   */
  createProgramFromTemplate(templateId: string, input: Readonly<{ title: string; clientIds: readonly string[] }>,
    now?: Date): Promise<TrainingProgram>;
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
  findWorkout(clientId: string, programId: string, plannedWorkoutId: string, weekIndex?: number):
    Promise<Readonly<{ program: TrainingProgram; workout: PlannedWorkout }> | null>;
  getSimpleWeeks(clientId: string, programId: string): Promise<readonly SimpleWeek[]>;
  getSimpleVersions(clientId: string, programId: string): Promise<readonly SimplePlanVersion[]>;
  previewSimpleWorkout(clientId: string, programId: string, expectedRevision: number, input: SimpleWorkoutEdit): Promise<WeekEditPreview>;
  saveSimpleWorkout(clientId: string, programId: string, expectedRevision: number, input: SimpleWorkoutEdit, now?: Date): Promise<TrainingProgram>;
  getSimpleWorkoutDraft(clientId: string, programId: string, weekIndex: number, workoutId: string): Promise<SimpleWorkoutDraft | null>;
  saveSimpleWorkoutDraft(clientId: string, programId: string, draft: SimpleWorkoutDraft): Promise<void>;
  /** Тот же слот Простой / lineageId внутри текущего мезоцикла. Нет однозначного соответствия — null в неделе. */
  getWorkoutWeekNavigation(clientId: string, programId: string, plannedWorkoutId: string): Promise<WorkoutWeekNavigation | null>;
  /** Расширенная программа этого участника: его мезоциклы, недели и выбранный мезоцикл. */
  getPeriodizedPlan(clientId: string, programId: string): Promise<PeriodizedPlan | null>;
  /** Сначала действующая, затем все неизменяемые исторические версии; у чужого мезоцикла версий нет. */
  getMesocycleVersions(clientId: string, programId: string, mesocycleId: string): Promise<readonly MesocycleVersion[]>;
  /**
   * Новый мезоцикл (§48.12.1 п. 1): каждому выбранному участнику — своя копия с общим родством, одной
   * транзакцией по ревизии программы; открывшему клиенту он становится выбранным.
   */
  createMesocycle(clientId: string, programId: string, expectedRevision: number, input: NewMesocycleInput,
    now?: Date): Promise<Readonly<{ program: TrainingProgram; mesocycleId: string }>>;
  /** Независимая копия действующей структуры только выбранным получателям; ревизии источника и цели проверяются в одной транзакции. */
  copyMesocycle(clientId: string, programId: string, expectedRevision: number, input: CopyMesocycleInput,
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
