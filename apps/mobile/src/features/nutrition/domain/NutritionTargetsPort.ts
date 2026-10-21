import type { Corridors, TargetException, TargetVersion, TargetVersionInput } from "./TargetModel.ts";

export interface TargetsCommittedChange {
  readonly clientId: string;
}

/**
 * Цели питания клиента: датированные версии расписания и разовые исключения (§§49.8–49.12).
 * Ошибки: TargetRuleError, TARGET_VERSION_EXISTS (версия на эту дату уже есть, нужна её revision), TARGET_STALE.
 * Цели не меняют и не создают пищевые записи; все операции ограничены `clientId`.
 */
export interface NutritionTargetsPort {
  /** Все версии клиента по возрастанию даты начала. */
  listVersions(clientId: string): Promise<readonly TargetVersion[]>;
  /**
   * Новая версия с `effectiveFrom`; если на эту дату версия уже есть, правится только с её `expectedRevision` (две версии на одну дату невозможны).
   * Прошлые версии не удаляются и не переписываются. homeAdjustment сохраняется атомарно с итоговыми коридорами;
   * отсутствие метаданных при правке расписания снимает режим ручной корректировки главной.
   */
  saveVersion(clientId: string, input: TargetVersionInput, expectedRevision: number | null, now?: Date): Promise<TargetVersion>;
  listExceptions(clientId: string): Promise<readonly TargetException[]>;
  /** Задаёт или заменяет исключение даты; исключение не стирается при смене расписания. */
  setException(clientId: string, localDate: string, corridors: Corridors, now?: Date): Promise<TargetException>;
  clearException(clientId: string, localDate: string): Promise<void>;
  subscribeCommittedChanges(listener: (change: TargetsCommittedChange) => void): () => void;
}
