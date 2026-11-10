import type { HealthAvailability, HealthDayValue, HealthLink, HealthMetric, HealthRange } from "./HealthModel.ts";

export interface HealthCommittedChange {
  readonly clientId: string;
}

/**
 * Хранилище данных Health Connect (владелец — `health`). Одна привязка на всё рабочее пространство: «для себя». Отключение снимает привязку, но записанные
 * дни остаются; окончательное удаление клиента убирает и привязку, и дни. Ошибки: `HEALTH_ALREADY_LINKED`, `HEALTH_NOT_LINKED`, `HEALTH_VALUE_INVALID`.
 */
export interface HealthStorePort {
  getLink(): Promise<HealthLink | null>;
  /** Привязать карточку; уже привязана другая — `HEALTH_ALREADY_LINKED`, та же — привязка возвращается как есть. */
  link(clientId: string, now?: Date): Promise<HealthLink>;
  /** Снять привязку; записанные дни не удаляются. */
  unlink(): Promise<void>;
  /** Дни за закрытый интервал; нет записи — нет значения (неизвестно ≠ 0). */
  listDaily(clientId: string, from: string, to: string): Promise<readonly HealthDayValue[]>;
  /** Записать дни и время синхронизации одной транзакцией (значения за день заменяются). Клиент должен быть привязан. */
  saveSync(clientId: string, values: readonly HealthDayValue[], granted: readonly HealthMetric[], now?: Date): Promise<void>;
  subscribeCommittedChanges(listener: (change: HealthCommittedChange) => void): () => void;
}

/** Граница с Health Connect на устройстве: платформа читает, домен ничего не пишет в систему (ADR-059). */
export interface HealthConnectPort {
  availability(): Promise<HealthAvailability>;
  /** Виды данных, на которые разрешение уже дано. */
  grantedMetrics(): Promise<readonly HealthMetric[]>;
  /** Системное окно разрешений; возвращает виды, разрешённые после ответа. */
  requestPermissions(): Promise<readonly HealthMetric[]>;
  /** Значения по локальным дням интервала для разрешённых видов. */
  readDaily(metrics: readonly HealthMetric[], range: HealthRange): Promise<readonly HealthDayValue[]>;
  openSettings(): void;
  /** Отозвать все разрешения этого приложения в Health Connect. */
  revokeAll(): Promise<void>;
}
