/** Куда ведёт нажатие на уведомление или на панель таймера отдыха. */
export type NotificationTarget =
  | Readonly<{ kind: "CALENDAR" }>
  | Readonly<{ kind: "CLIENT_TRAINING"; clientId: string }>
  | Readonly<{ kind: "WORKOUT"; clientId: string; programId: string; weekIndex: number; plannedWorkoutId: string; exerciseKey: string | null }>;

/**
 * Строка центра и напоминание календаря: дежурство и запись гостя — в Календарь; запись клиента — в раздел «Тренировки» этого клиента;
 * «пора выбрать исход» — в Календарь, где исход и выбирается (допущение владельцем не оспорено, 2026-10-22).
 */
export function calendarEventTarget(event: Readonly<{ sourceType: string; eventKind: string; clientId: string | null }>): NotificationTarget {
  if (event.sourceType === "APPOINTMENT" && event.eventKind === "REMINDER" && event.clientId !== null && event.clientId !== "") {
    return { kind: "CLIENT_TRAINING", clientId: event.clientId };
  }
  return { kind: "CALENDAR" };
}

const text = (value: unknown): string | null => typeof value === "string" && value !== "" ? value : null;

/**
 * Полезная нагрузка системного уведомления → цель. Нагрузка содержит только идентификаторы (§44.22); неизвестный или повреждённый вид
 * возвращает `null` — приложение просто открывается, без перехода и без падения.
 */
export function targetOfPayload(data: unknown): NotificationTarget | null {
  if (typeof data !== "object" || data === null) return null;
  const payload = data as Record<string, unknown>;
  if (payload.kind === "calendar-reminder") {
    const sourceType = text(payload.sourceType);
    const eventKind = text(payload.eventKind);
    return sourceType === null || eventKind === null ? null : calendarEventTarget({ sourceType, eventKind, clientId: text(payload.clientId) });
  }
  if (payload.kind === "rest-timer") {
    const clientId = text(payload.clientId);
    if (clientId === null) return null;
    const programId = text(payload.programId);
    const plannedWorkoutId = text(payload.plannedWorkoutId);
    const weekIndex = payload.weekIndex;
    if (programId !== null && plannedWorkoutId !== null && typeof weekIndex === "number" && Number.isInteger(weekIndex) && weekIndex >= 0) {
      return { kind: "WORKOUT", clientId, programId, weekIndex, plannedWorkoutId, exerciseKey: text(payload.exerciseKey) };
    }
    return { kind: "CLIENT_TRAINING", clientId };
  }
  return null;
}

/** Тот же переход для панели таймера: у старых таймеров без происхождения — «Тренировки» клиента. */
export function timerTarget(timer: Readonly<{ clientId: string; programId: string | null; weekIndex: number | null; plannedWorkoutId: string | null;
  exerciseKey: string }>): NotificationTarget {
  if (timer.programId !== null && timer.weekIndex !== null && timer.plannedWorkoutId !== null) {
    return { kind: "WORKOUT", clientId: timer.clientId, programId: timer.programId, weekIndex: timer.weekIndex, plannedWorkoutId: timer.plannedWorkoutId,
      exerciseKey: timer.exerciseKey };
  }
  return { kind: "CLIENT_TRAINING", clientId: timer.clientId };
}
