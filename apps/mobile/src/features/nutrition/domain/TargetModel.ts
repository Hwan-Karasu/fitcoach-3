/** Показатели цели питания (§49.8): калории, белки, жиры, углеводы. */
export const TARGET_METRICS = ["kcal", "protein", "fat", "carbs"] as const;
export type TargetMetric = typeof TARGET_METRICS[number];

/** Допустимый интервал, десятые доли (ккал×10 или г×10), границы включены; равные границы — точная цель как частный случай (§49.8.1). */
export interface TargetRange {
  readonly minX10: number;
  readonly maxX10: number;
}

/** Коридоры одного дня. `null` по показателю — цель по нему не задана (это не «0–0»). */
export type Corridors = Readonly<Record<TargetMetric, TargetRange | null>>;

/** Понедельник = 0 … воскресенье = 6. */
export type WeekdayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Датированная версия расписания: коридоры по дням недели (`null` — для этого дня цели нет), действует с `effectiveFrom` до следующей версии (§49.11). */
export interface TargetVersion {
  readonly id: string;
  readonly clientId: string;
  readonly effectiveFrom: string;
  /** Ровно 7 элементов, понедельник первым. */
  readonly days: readonly (Corridors | null)[];
  readonly revision: number;
}

export interface TargetVersionInput {
  readonly effectiveFrom: string;
  readonly days: readonly (Corridors | null)[];
}

/** Разовое исключение на конкретную дату клиента (§49.12). */
export interface TargetException {
  readonly clientId: string;
  readonly localDate: string;
  readonly corridors: Corridors;
}

/** Откуда взята цель даты: исключение → версия расписания → «цель не установлена» (§49.12.2). */
export type ResolvedTarget =
  | Readonly<{ source: "EXCEPTION"; corridors: Corridors }>
  | Readonly<{ source: "SCHEDULE"; effectiveFrom: string; corridors: Corridors }>
  | Readonly<{ source: "NONE" }>;

/** Сравнение факта с коридором одного показателя; `UNKNOWN` — нет цели или нет надёжного факта, а не «ниже» (§49.8.1.2). */
export type RangeVerdict = "BELOW" | "IN" | "ABOVE" | "UNKNOWN";
