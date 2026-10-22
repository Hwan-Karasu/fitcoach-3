/** §22.1.4: where the client's session count lives. Only FITCOACH touches the Credit Ledger. */
export type AccountingMode = "FITCOACH" | "EXTERNAL" | "UNTRACKED";
export type CreditScope = "GENERAL" | "SESSION_TYPE";
export type LedgerEntryType = "ISSUED" | "USED" | "RETURNED" | "ADJUSTMENT";
export type PaymentMethod = "transfer" | "cash" | "other";
/** Accounting state of one appointment; the factual outcome is a separate Calendar aspect (L02). */
export type AppointmentCreditState = "NONE" | "RESERVED" | "USED" | "RETURNED";

export interface SessionPack {
  readonly id: string;
  readonly title: string;
  readonly creditScope: CreditScope;
  readonly sessionTypeId: string | null;
  readonly sessionTypeName: string | null;
  readonly grantedCount: number;
  readonly totalKopeks: number;
  readonly expiresOn: string | null;
  readonly createdAt: string;
}

/** Derived from the ledger and open reservations, never stored as an editable counter. */
export interface PackBalance {
  readonly pack: SessionPack;
  readonly ledgerBalance: number;
  readonly reserved: number;
  readonly available: number;
  readonly paidKopeks: number;
}

export interface LedgerEntry {
  readonly id: string;
  readonly packId: string;
  readonly appointmentId: string | null;
  readonly sourceEntryId: string | null;
  readonly entryType: LedgerEntryType;
  readonly delta: number;
  readonly reason: string | null;
  readonly createdAt: string;
}

export interface PaymentRecord {
  readonly id: string;
  readonly packId: string | null;
  readonly amountKopeks: number;
  readonly paidOn: string;
  readonly method: PaymentMethod;
  readonly note: string | null;
  readonly createdAt: string;
}

export interface ClientAccountingSnapshot {
  readonly mode: AccountingMode;
  /** True when the client has no own override and follows the workspace default. */
  readonly inheritedMode: boolean;
  /** null — автоматический выбор; применяется только к новым резервам. */
  readonly preferredPackId: string | null;
  readonly packs: readonly PackBalance[];
  /** Запись, которую вернёт «Отменить» на Главной: последнее ещё не возвращённое списание; null — возвращать нечего. */
  readonly returnableDebitId: string | null;
  readonly available: number;
  readonly reserved: number;
  readonly ledger: readonly LedgerEntry[];
  readonly payments: readonly PaymentRecord[];
}

export interface NewPackInput {
  readonly title: string;
  readonly creditScope: CreditScope;
  readonly sessionTypeId: string | null;
  readonly sessionTypeName: string | null;
  readonly grantedCount: number;
  readonly totalKopeks: number;
  readonly expiresOn: string | null;
  /** Необязательная полная оплата: сумма равна стоимости пакета, запись в одной транзакции. */
  readonly payment?: Readonly<{ paidOn: string; method: PaymentMethod }>;
}

export interface NewPaymentInput {
  readonly packId: string | null;
  readonly amountKopeks: number;
  readonly paidOn: string;
  readonly method: PaymentMethod;
  readonly note: string | null;
}

/** What booking this client with this session type would do to credits right now. */
export type BookingCreditContext =
  | Readonly<{ kind: "NOT_TRACKED"; mode: AccountingMode }>
  | Readonly<{ kind: "NOT_REQUIRED" }>
  | Readonly<{ kind: "AVAILABLE"; available: number; preferredPackTitle?: string }>
  | Readonly<{ kind: "PREFERRED_UNAVAILABLE" }>
  | Readonly<{ kind: "NONE_AVAILABLE" }>;

export interface ReconcileResult {
  readonly settled: number;
}
