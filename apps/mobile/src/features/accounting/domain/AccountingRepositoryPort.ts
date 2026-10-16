import type { AccountingMode, AppointmentCreditState, BookingCreditContext, ClientAccountingSnapshot,
  NewPackInput, NewPaymentInput, ReconcileResult, SessionPack } from "./AccountingModel.ts";

export interface AccountingCommittedChange {
  readonly clientIds: readonly string[] | "ALL";
}

/**
 * Typed failures: ACCOUNTING_INSUFFICIENT_CREDIT, ACCOUNTING_ALREADY_SETTLED,
 * ACCOUNTING_PACK_INVALID, ACCOUNTING_PACK_SCOPE_INVALID, ACCOUNTING_PAYMENT_INVALID.
 */
export interface AccountingRepositoryPort {
  getClientSnapshot(clientId: string): Promise<ClientAccountingSnapshot>;
  /** null clears the override so the client follows the workspace default. */
  setClientMode(clientId: string, mode: AccountingMode | null): Promise<void>;
  /** Pack creation and its ISSUED +N entry commit together. */
  createPack(clientId: string, input: NewPackInput): Promise<SessionPack>;
  recordPayment(clientId: string, input: NewPaymentInput): Promise<void>;
  /** Explicit manual correction with a reason; never edits an existing entry. */
  adjust(clientId: string, packId: string, delta: number, reason: string): Promise<void>;
  bookingContext(clientId: string, sessionTypeId: string, requiresCredit: boolean): Promise<BookingCreditContext>;
  appointmentCredit(appointmentId: string): Promise<AppointmentCreditState>;
  /** Idempotent: every reservation whose interval ended becomes exactly one USED. */
  reconcileDue(now: Date): Promise<ReconcileResult>;
  subscribeCommittedChanges(listener: (change: AccountingCommittedChange) => void): () => void;
}
