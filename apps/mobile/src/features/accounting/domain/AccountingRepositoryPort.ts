import type { AccountingMode, AppointmentCreditState, BookingCreditContext, ClientAccountingSnapshot,
  NewPackInput, NewPaymentInput, ReconcileResult, SessionPack } from "./AccountingModel.ts";

export interface AccountingCommittedChange {
  readonly clientIds: readonly string[] | "ALL";
}

/**
 * Typed failures: ACCOUNTING_INSUFFICIENT_CREDIT, ACCOUNTING_ALREADY_SETTLED,
 * ACCOUNTING_PACK_INVALID, ACCOUNTING_PACK_SCOPE_INVALID, ACCOUNTING_PAYMENT_INVALID,
 * ACCOUNTING_NOTHING_TO_RETURN, ACCOUNTING_STALE (последнее списание уже другое).
 */
export interface AccountingRepositoryPort {
  getClientSnapshot(clientId: string): Promise<ClientAccountingSnapshot>;
  /** null clears the override so the client follows the workspace default. */
  setClientMode(clientId: string, mode: AccountingMode | null): Promise<void>;
  /** null возвращает автоматический выбор. Существующие резервы и списания не меняются. */
  setPreferredPack(clientId: string, packId: string | null): Promise<void>;
  /** Pack, ISSUED +N и необязательная полная оплата коммитятся атомарно. */
  createPack(clientId: string, input: NewPackInput): Promise<SessionPack>;
  recordPayment(clientId: string, input: NewPaymentInput): Promise<void>;
  /** Explicit manual correction with a reason; never edits an existing entry. */
  adjust(clientId: string, packId: string, delta: number, reason: string): Promise<void>;
  /** Ручное списание −1 с «следующего» пакета (ADJUSTMENT); без доступного занятия — ACCOUNTING_INSUFFICIENT_CREDIT, при режиме не «В приложении» — ACCOUNTING_NOT_TRACKED. */
  writeOff(clientId: string): Promise<void>;
  /**
   * Возвращает последнее ещё не возвращённое списание (ручное или по записи календаря) новой записью RETURNED +1.
   * `expectedEntryId` — запись, которую видел тренер; если последнее списание уже другое — ACCOUNTING_STALE.
   */
  returnLastDebit(clientId: string, expectedEntryId: string): Promise<void>;
  bookingContext(clientId: string, sessionTypeId: string, requiresCredit: boolean): Promise<BookingCreditContext>;
  appointmentCredit(appointmentId: string): Promise<AppointmentCreditState>;
  /** Idempotent: every reservation whose interval ended becomes exactly one USED. */
  reconcileDue(now: Date): Promise<ReconcileResult>;
  subscribeCommittedChanges(listener: (change: AccountingCommittedChange) => void): () => void;
}
