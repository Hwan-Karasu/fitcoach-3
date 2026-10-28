import type { SqliteStatementPort } from "../../../shared/db/SqlitePort.ts";
import type { CancelSettlement } from "../domain/CalendarModel.ts";

/** Credit-relevant view of one appointment; Calendar stays the owner of the appointment itself. */
export interface DevBooking {
  readonly clientId: string | null;
  readonly sessionTypeId: string;
  readonly requiresCredit: boolean;
  readonly bypass: boolean;
  readonly localDate: string;
  readonly endMinute: number;
}

/**
 * CalendarAccountingWorkflow seam (§22.1.4): called inside the Calendar transaction, so a failed
 * reservation rolls the appointment back too. Wired only by the composition root.
 */
export interface DevAppointmentAccountingHook {
  /** Pack to reserve from, null when no credit applies; throws ACCOUNTING_INSUFFICIENT_CREDIT. */
  plan(tx: SqliteStatementPort, workspaceId: string, booking: DevBooking): Promise<string | null>;
  reserve(tx: SqliteStatementPort, workspaceId: string, appointmentId: string,
    booking: DevBooking, packId: string): Promise<void>;
  /** Before a client/type/bypass change; throws ACCOUNTING_ALREADY_SETTLED after a USED. */
  release(tx: SqliteStatementPort, workspaceId: string, appointmentId: string): Promise<void>;
  /** Same appointment ID moved in time: the reservation follows it without USED/RETURNED. */
  move(tx: SqliteStatementPort, workspaceId: string, appointmentId: string, booking: DevBooking): Promise<void>;
  cancel(tx: SqliteStatementPort, workspaceId: string, appointmentId: string,
    settlement: CancelSettlement, now: string): Promise<void>;
  /** A chosen Завершена/Пропущена: an open reservation becomes the single USED; never a second one. */
  settle(tx: SqliteStatementPort, workspaceId: string, appointmentId: string, now: string): Promise<void>;
  /**
   * Снятие «Проведена», поставленной дневником (ADR-048): единственное действующее USED компенсируется связанным RETURNED, запись
   * снова держит резерв того же пакета — как до завершения. Нет действующего USED (кредит не нужен) — ничего не делает.
   */
  unsettle(tx: SqliteStatementPort, workspaceId: string, appointmentId: string, booking: DevBooking, now: string): Promise<void>;
  /**
   * «Исправить клиента»: compensate the old client's USED (or drop its reservation) and charge the
   * new booking; throws ACCOUNTING_INSUFFICIENT_CREDIT so the whole correction rolls back.
   */
  correct(tx: SqliteStatementPort, workspaceId: string, appointmentId: string,
    booking: DevBooking, now: string): Promise<void>;
  /** Undo of «Отменена»: charge a started record again (one new USED) or reserve a future one. */
  restore(tx: SqliteStatementPort, workspaceId: string, appointmentId: string,
    booking: DevBooking, charge: boolean, now: string): Promise<void>;
}
