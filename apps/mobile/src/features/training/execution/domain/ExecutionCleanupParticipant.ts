import type { SessionOrigin } from "./TrainingExecutionPort.ts";

/**
 * Сторона дневника при удалении мезоцикла или программы (§48.11, §50.3): выполнения и факты клиента в программе —
 * все (`plannedWorkoutIds = null`) или только перечисленных тренировок. Другие клиенты не затрагиваются.
 */
export interface ExecutionCleanupParticipant<Tx> {
  remove(tx: Tx, clientId: string, programId: string, plannedWorkoutIds: readonly string[] | null): Promise<void>;
  /**
   * §50.3, действие 1: план удаляется, результаты остаются — выполнения клиента в программе получают неизменяемый
   * снимок происхождения по слоту (неделя + тренировка) и выпадают из экранов программы.
   */
  keepAsHistory(tx: Tx, clientId: string, programId: string, originOf: (weekIndex: number, plannedWorkoutId: string) => SessionOrigin,
    now: Date): Promise<void>;
  notify(clientId: string, programId: string): void;
}
