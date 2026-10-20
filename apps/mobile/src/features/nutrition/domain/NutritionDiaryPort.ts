import type { DiaryEntry, DiaryEntryInput, WaterDay } from "./DiaryModel.ts";

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
  /** Записи клиента за закрытый диапазон дат, по дате, приёму пищи и порядку. */
  listEntries(clientId: string, fromDate: string, toDate: string): Promise<readonly DiaryEntry[]>;
  /** Добавляет новую запись в конец приёма пищи; итог снимка пересчитывается из значений на основу и количества. */
  addEntry(clientId: string, input: DiaryEntryInput, now?: Date): Promise<DiaryEntry>;
  /** Исправляет только количество этой записи; снимок источника не переписывается (§49.5.2). */
  updateQuantity(clientId: string, id: string, expectedRevision: number, quantityX10: number, now?: Date): Promise<DiaryEntry>;
  /** Явное удаление записи; последняя запись дня выводит дату из учёта, вода остаётся. */
  removeEntry(clientId: string, id: string, expectedRevision: number): Promise<void>;
  listWater(clientId: string, fromDate: string, toDate: string): Promise<readonly WaterDay[]>;
  /** Задаёт воду за день (заменяет прежнее значение). Еду и учёт дня не создаёт. */
  setWater(clientId: string, localDate: string, ml: number, now?: Date): Promise<WaterDay>;
  clearWater(clientId: string, localDate: string): Promise<void>;
  subscribeCommittedChanges(listener: (change: DiaryCommittedChange) => void): () => void;
}
