/** Канонические метрики карточки V1 по умолчанию (§7.7): следующее занятие, последняя тренировка, абонемент. */
export type RosterMetricId = "nextAppointment" | "lastTraining" | "credits";

/** `value: null` — «нет данных», а не ноль (§51.2.3). */
export interface RosterMetricValue {
  readonly id: RosterMetricId;
  readonly value: string | null;
}

/** Факты других владельцев для одной карточки списка (Feature 02 §4, GetRosterMetrics). */
export interface RosterClientOverview {
  readonly metrics: readonly RosterMetricValue[];
  /** Нейтральный индикатор ограничений без раскрытия диагнозов (§7). */
  readonly restricted: boolean;
  /** «Сегодня по расписанию»: начало ближайшей сегодняшней ещё не закончившейся записи. */
  readonly todayStartMinute: number | null;
  /** Когда эта запись закончится — момент, когда фильтр «Сегодня» может измениться. */
  readonly todayEndMinute: number | null;
}

export type RosterOverview = ReadonlyMap<string, RosterClientOverview>;

/** Пакетный запрос сводки для видимых карточек; подписка — на зафиксированные изменения владельцев. */
export interface RosterOverviewPort {
  load(clientIds: readonly string[], now: Date): Promise<RosterOverview>;
  subscribe(listener: () => void): () => void;
}
