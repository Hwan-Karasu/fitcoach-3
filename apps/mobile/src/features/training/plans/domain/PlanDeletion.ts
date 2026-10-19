/**
 * Удаление мезоцикла (§48.11) и программы (§50.3 «полностью с результатами», решение владельца 2026-10-19) — только
 * у открытого клиента: копии и результаты других участников не трогаются. Планы и дневник удаляют своё в одной
 * транзакции (workflow).
 */
export interface MesocycleDeleteRequest {
  readonly clientId: string;
  readonly programId: string;
  readonly mesocycleId: string;
  readonly expectedRevision: number;
}

export interface ProgramDeleteRequest {
  readonly clientId: string;
  readonly programId: string;
  readonly expectedRevision: number;
}

export interface MesocycleDeletePort {
  /** Возвращает мезоцикл, выбранный после удаления (ближайший, §48.11.1 п. 6). */
  deleteMesocycle(request: MesocycleDeleteRequest): Promise<string>;
}

export interface ProgramDeletePort {
  deleteProgram(request: ProgramDeleteRequest): Promise<void>;
}

/** Сторона планов в общих транзакциях удаления. */
export interface PlanDeletePlansParticipant<Tx> {
  /** Тренировки мезоцикла этого клиента; мезоцикл должен быть не последним (иначе `LAST_MESOCYCLE`). */
  mesocycleWorkouts(tx: Tx, request: MesocycleDeleteRequest): Promise<readonly string[]>;
  deleteMesocycle(tx: Tx, request: MesocycleDeleteRequest, now: Date): Promise<string>;
  deleteProgram(tx: Tx, request: ProgramDeleteRequest, now: Date): Promise<void>;
  notify(clientIds: readonly string[]): void;
}
