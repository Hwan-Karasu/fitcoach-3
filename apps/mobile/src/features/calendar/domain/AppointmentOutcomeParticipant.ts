import type { LocalDate } from "./CalendarModel.ts";

/** Запись календаря, которую отмечает дневник: достаточно для выбора, проведения и подсказки. */
export interface StartedAppointmentRef {
  readonly id: string;
  readonly revision: number;
  readonly startMinute: number;
  /** День самой записи: уведомлять нужно его, а не день тренировки (дату тренировки правят после завершения). */
  readonly localDate: LocalDate;
}

/**
 * Участник транзакции «Завершить тренировку → запись календаря» (ADR-048). Правило выбора одно и явное: тот же клиент, указанная
 * дата, исхода нет, занятие уже началось, при нескольких — с самым поздним началом. Учёт (ровно один USED) — тот же, что у
 * `resolveOutcome`; публикация изменений — после commit через `notify`.
 */
export interface AppointmentOutcomeParticipant<Tx> {
  findStartedPending(tx: Tx, clientId: string, localDate: LocalDate, now: Date): Promise<StartedAppointmentRef | null>;
  /** «Проведена» для записи, найденной `findStartedPending` в этой же транзакции. */
  complete(tx: Tx, appointment: StartedAppointmentRef, now: Date): Promise<void>;
  /** Снимает исход, только если он «Проведена» (вручную смененный на «Пропущена» не трогается); `null` — не снято. */
  clearIfCompleted(tx: Tx, appointmentId: string, now: Date): Promise<StartedAppointmentRef | null>;
  notify(dates: readonly LocalDate[]): void;
}
