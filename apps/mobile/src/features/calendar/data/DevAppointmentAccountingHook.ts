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
}
