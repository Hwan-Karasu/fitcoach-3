import type { ClientMeasurements, Measurement, MeasurementInput, MeasurementOperation } from "./MeasurementModel.ts";

export interface MeasurementCommittedChange {
  readonly clientId: string;
}

/** Запись дневного значения внутри общей транзакции; выбор основной записи и изменение атомарны. */
export interface DailyMeasurementParticipant<Tx> {
  upsert(tx: Tx, clientId: string, input: MeasurementInput, now: Date): Promise<Measurement>;
  notify(clientId: string): void;
}

/**
 * Body Measurements owner (§§10.13.1, 49.14–49.18). Typed failures: MeasurementRuleError codes,
 * MEASUREMENT_STALE (revision or scope changed).
 */
export interface MeasurementRepositoryPort {
  listForClient(clientId: string): Promise<ClientMeasurements>;
  /** Always a new fact, even with the same type, date and value (§49.15). */
  record(clientId: string, input: MeasurementInput, now?: Date): Promise<Measurement>;
  /** Вставить/исправить одно дневное значение атомарно; неоднозначный день требует явного выбора основной записи. */
  upsertDaily(clientId: string, input: MeasurementInput, now?: Date): Promise<Measurement>;
  /** Импорт: создать факт только если день/тип ещё пусты. Существующий (включая ручной) факт не заменяется. */
  recordIfDayEmpty(clientId: string, input: MeasurementInput, now?: Date): Promise<Measurement | null>;
  /** Corrects this entry only and keeps its ID; a moved date or type drops its primary mark. */
  correct(id: string, expectedRevision: number, input: MeasurementInput, now?: Date): Promise<Measurement>;
  /**
   * Несколько правок одного клиента одной транзакцией: все или ни одной, одно событие после commit.
   * Любая устаревшая revision или неверное значение отменяет всё (MEASUREMENT_STALE / ошибка правила).
   */
  applyBatch(clientId: string, operations: readonly MeasurementOperation[], now?: Date): Promise<void>;
  /** Explicit delete of one entry; its primary mark is removed and nothing else is promoted. */
  remove(id: string, expectedRevision: number): Promise<void>;
  /** Marks the daily primary for its own `type + date`, replacing the previous choice. */
  setPrimary(id: string): Promise<void>;
  subscribeCommittedChanges(listener: (change: MeasurementCommittedChange) => void): () => void;
}

