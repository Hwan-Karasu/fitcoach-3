/** One Home stat tile; `value: null` is «нет данных», never a zero (§51.2.3). */
export interface HomeMetric {
  readonly label: string;
  readonly value: string | null;
  readonly unit?: string;
  readonly status?: string;
}

export type HomePackTone = "active" | "warning" | "empty";

/** Abonement summary derived from the Credit Ledger by its owner, not a mutable counter (§51.2.4). */
export type HomePackSummary =
  | Readonly<{ kind: "UNAVAILABLE" }>
  | Readonly<{ kind: "NOT_TRACKED"; label: string }>
  | Readonly<{ kind: "NO_PACK" }>
  | Readonly<{ kind: "TRACKED"; available: number; reserved: number; tone: HomePackTone;
    pricePerSession: string | null; expiresOn: string | null }>;

/** Read-only projection of other owners' facts for the client Home (§§51, 53.4). */
export interface ClientHomeSummary {
  readonly metrics: readonly HomeMetric[];
  readonly pack: HomePackSummary;
}
