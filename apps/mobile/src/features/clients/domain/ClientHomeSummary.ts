export type HomePackTone = "active" | "warning" | "empty";

/** Abonement summary derived from the Credit Ledger by its owner, not a mutable counter (§51.2.4). */
export type HomePackSummary =
  | Readonly<{ kind: "UNAVAILABLE" }>
  | Readonly<{ kind: "NOT_TRACKED"; label: string }>
  | Readonly<{ kind: "NO_PACK" }>
  | Readonly<{ kind: "TRACKED"; available: number; /** Начислено по выбранному пакету; без выбора — по действующим пакетам. */ granted: number; reserved: number; tone: HomePackTone;
    pricePerSession: string | null; expiresOn: string | null;
    /** Есть пакет, с которого уйдёт «Списать» (выбранный или ближайший по сроку). */ writeOffAvailable: boolean;
    /** Списание, которое вернёт «Отменить»; null — возвращать нечего. */ returnableDebitId: string | null }>;

/** Read-only projection of other owners' facts for the client Home (§§51, 53.4). */
export interface ClientHomeSummary {
  readonly pack: HomePackSummary;
}
