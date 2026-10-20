import type { FoodInput, FoodProduct } from "./FoodModel.ts";

export interface FoodCatalogCommittedChange {
  readonly foodId: string;
}

/**
 * Локальный каталог собственных продуктов (§49.3). Ошибки: FoodRuleError, FOOD_STALE (нет записи или устарела revision).
 */
export interface FoodCatalogPort {
  /** Активные продукты; `query` — подстрока названия или марки без учёта регистра. Архивные не возвращаются. */
  search(query?: string): Promise<readonly FoodProduct[]>;
  /** Продукт по id, в том числе скрытый: история использования его читает. */
  get(id: string): Promise<FoodProduct | null>;
  create(input: FoodInput, now?: Date): Promise<FoodProduct>;
  /** Меняет только будущие использования; ранее сохранённые дни не пересчитываются (§49.5.2). */
  update(id: string, expectedRevision: number, input: FoodInput, now?: Date): Promise<FoodProduct>;
  /** «Удаление» из активного каталога — скрытие записи; повтор на скрытом продукте безопасен. */
  archive(id: string, expectedRevision: number, now?: Date): Promise<FoodProduct>;
  subscribeCommittedChanges(listener: (change: FoodCatalogCommittedChange) => void): () => void;
}
