/**
 * Сторона дневника при удалении мезоцикла или программы (§48.11, §50.3): выполнения и факты клиента в программе —
 * все (`plannedWorkoutIds = null`) или только перечисленных тренировок. Другие клиенты не затрагиваются.
 */
export interface ExecutionCleanupParticipant<Tx> {
  remove(tx: Tx, clientId: string, programId: string, plannedWorkoutIds: readonly string[] | null): Promise<void>;
  notify(clientId: string, programId: string): void;
}
