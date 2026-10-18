/** Перестановка недель (§48.21 п. 6): номер недели у выполнений следует за их тренировками; факты не клонируются. */
export interface WeekRenumberInput {
  readonly clientId: string;
  readonly programId: string;
  readonly first: number;
  readonly second: number;
  /** Плановые тренировки, переехавшие с позиции `first` на `second`, и наоборот. */
  readonly toSecond: readonly string[];
  readonly toFirst: readonly string[];
}

export interface WeekRenumberParticipant<Tx> {
  renumber(tx: Tx, input: WeekRenumberInput, now: Date): Promise<void>;
  notify(clientId: string, programId: string): void;
}
