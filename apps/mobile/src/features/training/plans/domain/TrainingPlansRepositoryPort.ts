import type { ClientProgramLibrary, CreateProgramInput, TrainingProgram } from "./ProgramModel.ts";

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
  subscribeCommittedChanges(listener: (change: TrainingPlansCommittedChange) => void): () => void;
}
