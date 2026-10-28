import type { WorkoutOutcome, WorkoutSession, WorkoutSlot } from "./ExecutionModel.ts";

/**
 * Участник транзакции «исход тренировки + запись календаря» (ADR-048). Исход пишется как раньше (CAS по ревизии); связь с записью
 * календаря хранится в сессии и не меняет её ревизию.
 */
export interface WorkoutOutcomeParticipant<Tx> {
  /** Исход в транзакции вызывающего; `previous` — исход до записи (чтобы понять, снимается ли «Завершена»). */
  setOutcome(tx: Tx, slot: WorkoutSlot, outcome: WorkoutOutcome | null, expectedRevision: number | null, now: Date):
    Promise<Readonly<{ session: WorkoutSession; previous: WorkoutOutcome | null }>>;
  appointmentLink(tx: Tx, slot: WorkoutSlot): Promise<string | null>;
  setAppointmentLink(tx: Tx, slot: WorkoutSlot, appointmentId: string | null): Promise<void>;
  /** Календарный день момента `at` по правилам дневника (дата выполнения ставится так же). */
  dayOf(at: Date): string;
  notify(slot: WorkoutSlot): void;
}
