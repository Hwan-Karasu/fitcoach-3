import type { ClientProgramLibrary, CreateProgramInput, TrainingProgram } from "./ProgramModel.ts";
import type { SimpleProgramDraft } from "./SimplePlanModel.ts";

export interface TrainingPlansCommittedChange {
  /** Клиенты, чья библиотека изменилась. */
  readonly clientIds: readonly string[];
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
  /** §48.29 Recovery Draft: ключ — `new:SIMPLE` или ID программы. Не публикует изменения в план. */
  getBuilderDraft(clientId: string, key: string): Promise<Readonly<{ baseRevision: number | null; draft: SimpleProgramDraft }> | null>;
  saveBuilderDraft(clientId: string, key: string, baseRevision: number | null, draft: SimpleProgramDraft): Promise<void>;
  clearBuilderDraft(clientId: string, key: string): Promise<void>;
  subscribeCommittedChanges(listener: (change: TrainingPlansCommittedChange) => void): () => void;
}
