/** §48.2: два самостоятельных конструктора — простой (один клиент) и расширенный (мезоциклы, участники). */
export type ProgramKind = "SIMPLE" | "PERIODIZED";

export interface TrainingProgram {
  readonly id: string;
  readonly kind: ProgramKind;
  readonly title: string;
  readonly revision: number;
  readonly createdAt: string;
  /** Участники: клиенты, у которых программа в библиотеке. Факты выполнения у каждого свои (§48.1). */
  readonly memberClientIds: readonly string[];
}

/** Карточка программы в библиотеке одного клиента: архив — свойство участия этого клиента, а не программы. */
export interface ProgramCard {
  readonly id: string;
  readonly kind: ProgramKind;
  readonly title: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly memberCount: number;
  readonly archivedAt: string | null;
  /** Место в библиотеке этого клиента после перетаскивания; `null` — ещё не упорядочена. */
  readonly sortPosition: number | null;
}

export interface ClientProgramLibrary {
  readonly clientId: string;
  /** Действующие программы: новые сверху. */
  readonly active: readonly ProgramCard[];
  /** Программы, убранные этим клиентом в архив. */
  readonly archived: readonly ProgramCard[];
  /** Выбранная (последняя открытая) программа клиента; архив её снимает, возврат из архива — не выбирает. */
  readonly selectedProgramId: string | null;
}

export interface CreateProgramInput {
  readonly kind: ProgramKind;
  readonly title: string;
  readonly clientIds: readonly string[];
}
