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
  /** Добавляет новую запись в конец приёма пищи; итог снимка пересчитывается из значений на основу и количества. */
  addEntry(clientId: string, input: DiaryEntryInput, now?: Date): Promise<DiaryEntry>;
  /** Добавляет несколько записей (в том числе одну позицию в разные приёмы) одной транзакцией: все или ни одной. */
  addEntries(clientId: string, inputs: readonly DiaryEntryInput[], now?: Date, commandId?: string): Promise<readonly DiaryEntry[]>;
  /** Исправляет только количество этой записи; снимок источника не переписывается (§49.5.2). */
  updateQuantity(clientId: string, id: string, expectedRevision: number, quantityX10: number, now?: Date): Promise<DiaryEntry>;
  /** Сохранить редактор целиком одним CAS и одной транзакцией; null сохраняет прежний override, CLEAR снимает его. */
  editEntry(clientId: string, id: string, expectedRevision: number, input: Readonly<{ quantityX10: number; slot: MealSlot; override: Nutrients | "CLEAR" | null }>, now?: Date): Promise<DiaryEntry>;
  /**
   * Ручная правка К/Б/Ж/У только этой записи (на её текущее количество; `null` — показатель не правится). Каталог, снимок, другие записи и клиенты не меняются;
   * при смене количества правка масштабируется пропорционально. Нужен хотя бы один показатель, иначе `DIARY_OVERRIDE_INVALID`.
   */
  setOverride(clientId: string, id: string, expectedRevision: number, values: Nutrients, now?: Date): Promise<DiaryEntry>;
  /** «Вернуть значения каталога»: снимает правку, значения снова по снимку на текущее количество. Записи без правки — `DIARY_STALE` не бросает, но revision должна совпасть. */
  clearOverride(clientId: string, id: string, expectedRevision: number, now?: Date): Promise<DiaryEntry>;
  /** Переносит запись в другой приём той же даты (в конец приёма): снимок и количество не меняются, дубля нет. Тот же приём — без изменений; устаревшая revision — `DIARY_STALE`. */
  moveEntry(clientId: string, id: string, expectedRevision: number, slot: MealSlot, now?: Date): Promise<DiaryEntry>;
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
