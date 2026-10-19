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

/** §50.3, действие 1: «Удалить план, сохранить историю занятий» — только для архивной программы клиента. */
export interface PlanOnlyDeletePort {
  deletePlanKeepHistory(request: ProgramDeleteRequest): Promise<void>;
}

/** Происхождение тренировок плана клиента: программа и по слоту «неделя:тренировка» — мезоцикл и название. */
export interface PlanOrigins {
  readonly programTitle: string;
  readonly programKind: "SIMPLE" | "PERIODIZED";
  readonly slots: ReadonlyMap<string, Readonly<{ mesocycleTitle: string | null; workoutTitle: string }>>;
}

/** Сторона планов в общих транзакциях удаления. */
export interface PlanDeletePlansParticipant<Tx> {
  /** Тренировки мезоцикла этого клиента; мезоцикл должен быть не последним (иначе `LAST_MESOCYCLE`). */
  mesocycleWorkouts(tx: Tx, request: MesocycleDeleteRequest): Promise<readonly string[]>;
  deleteMesocycle(tx: Tx, request: MesocycleDeleteRequest, now: Date): Promise<string>;
  deleteProgram(tx: Tx, request: ProgramDeleteRequest, now: Date): Promise<void>;
  /** Снимок происхождения перед удалением только плана; программа должна быть в архиве клиента (`PROGRAM_NOT_ARCHIVED`). */
  planOrigins(tx: Tx, request: ProgramDeleteRequest): Promise<PlanOrigins>;
  notify(clientIds: readonly string[]): void;
}
