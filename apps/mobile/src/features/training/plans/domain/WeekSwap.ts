/**
 * Перестановка двух недель мезоцикла (§48.21 п. 5–6): недели меняются местами целиком — план, результаты и
 * статус следуют за неделей, номер недели — её позиция. Только у этого клиента; новая версия мезоцикла (§48.21 п. 8).
 */
export interface WeekSwapRequest {
  readonly clientId: string;
  readonly programId: string;
  readonly mesocycleId: string;
  readonly first: number;
  readonly second: number;
  readonly expectedRevision: number;
}

export interface WeekSwapPort {
  swap(request: WeekSwapRequest): Promise<void>;
}

/** Сторона планов в общей транзакции: какие тренировки уехали на какую позицию. */
export interface WeekSwapPlansParticipant<Tx> {
  swap(tx: Tx, request: WeekSwapRequest, now: Date): Promise<Readonly<{ toSecond: readonly string[]; toFirst: readonly string[] }>>;
  notify(clientId: string): void;
}
