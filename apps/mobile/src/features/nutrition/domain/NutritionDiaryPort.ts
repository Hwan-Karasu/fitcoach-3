import type { Nutrients } from "./FoodModel.ts";
import type { SavedMeal, SavedMealInput } from "./SavedMeal.ts";
import type { CopyEntriesRequest, CopyEntriesResult, DiaryEntry, DiaryEntryInput, MealSlot, WaterDay } from "./DiaryModel.ts";

export interface DiaryCommittedChange {
  readonly clientId: string;
  /** Затронутая дата — для адресного обновления дня. */
  readonly localDate: string;
}

/**
 * Пищевой дневник клиента (§49.1–49.5, 49.22). Ошибки: DiaryRuleError, DIARY_STALE (нет записи или устарела revision).
 * Все чтения и записи ограничены `clientId`.
 */
export interface NutritionDiaryPort {
  listSearchQueries(clientId: string): Promise<readonly string[]>;
  rememberSearchQuery(clientId: string, query: string): Promise<void>;
  listSavedMeals(clientId: string): Promise<readonly SavedMeal[]>;
  createSavedMeal(clientId: string, input: SavedMealInput): Promise<SavedMeal>;
  updateSavedMeal(clientId: string, id: string, expectedRevision: number, input: SavedMealInput): Promise<SavedMeal>;
  removeSavedMeal(clientId: string, id: string, expectedRevision: number): Promise<void>;
  subscribeSavedMealChanges(listener: (clientId: string) => void): () => void;
  /** Записи клиента за закрытый диапазон дат, по дате, приёму пищи и порядку. */
  listEntries(clientId: string, fromDate: string, toDate: string): Promise<readonly DiaryEntry[]>;
  /**
   * Записи, достаточные для «Недавних» и «Частых» (`usageSuggestions`): все записи `limit` лучших позиций по этому порядку (и позиций, равных последней по ключу порядка)
   * до даты `toDate` включительно — не весь дневник. Результат применения `usageSuggestions` совпадает с расчётом по всем записям.
   */
  listUsageEntries(clientId: string, order: "recent" | "frequent", limit: number, toDate: string): Promise<readonly DiaryEntry[]>;
  /** Добавляет новую запись в конец приёма пищи; итог снимка пересчитывается из значений на основу и количества. */
  addEntry(clientId: string, input: DiaryEntryInput, now?: Date): Promise<DiaryEntry>;
  /** Добавляет несколько записей (в том числе одну позицию в разные приёмы) одной транзакцией: все или ни одной. */
  addEntries(clientId: string, inputs: readonly DiaryEntryInput[], now?: Date, commandId?: string): Promise<readonly DiaryEntry[]>;
  /**
   * Сохранить редактор целиком одним CAS и одной транзакцией; null сохраняет прежний override, CLEAR снимает его.
   * `copyToSlots` — приёмы той же даты, куда в той же транзакции добавляются копии с тем же количеством и той же правкой; повторы и приём записи пропускаются.
   */
  editEntry(clientId: string, id: string, expectedRevision: number, input: Readonly<{ quantityX10: number; slot: MealSlot; override: Nutrients | "CLEAR" | null;
    copyToSlots?: readonly MealSlot[] }>, now?: Date): Promise<DiaryEntry>;
  /** Явное удаление записи; последняя запись дня выводит дату из учёта, вода остаётся. */
  removeEntry(clientId: string, id: string, expectedRevision: number): Promise<void>;
  /**
   * Копирует снимки записей из источника в целевую дату одной транзакцией (§49.5.6): либо все записи, либо ни одной. Снимки не пересчитываются.
   * Режим `REPLACE` удаляет записи цели в копируемой области — вызывать только после явного подтверждения.
   */
  copyEntries(clientId: string, request: CopyEntriesRequest, now?: Date): Promise<CopyEntriesResult>;
  /** Ближайшая дата до `beforeDate` с пищевыми записями (в приёме `slot`, если задан); `null`, если такой нет. */
  previousFoodDate(clientId: string, beforeDate: string, slot: MealSlot | null): Promise<string | null>;
  listWater(clientId: string, fromDate: string, toDate: string): Promise<readonly WaterDay[]>;
  /** Задаёт воду за день (заменяет прежнее значение). Еду и учёт дня не создаёт. */
  setWater(clientId: string, localDate: string, ml: number, now?: Date): Promise<WaterDay>;
  clearWater(clientId: string, localDate: string): Promise<void>;
  subscribeCommittedChanges(listener: (change: DiaryCommittedChange) => void): () => void;
}
