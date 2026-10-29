/**
 * Прочитанный состав группы участников для места плана (клиент, программа, мезоцикл или тренировка; UI-OWN-044). Ответ относится к месту,
 * для которого его запросили: состав другого места (прежней программы) не показывается как состав этого, а загрузка и ошибка — не «один
 * участник» (PART-DOCK-1: после A(2) → B(1) → A полоса пропадала, пока не придёт новое чтение, а при ошибке чтения — насовсем).
 */
export type GroupRead<T> =
  | Readonly<{ place: string; version: number; status: "ready"; members: readonly T[] }>
  | Readonly<{ place: string; version: number; status: "error" }>;

/** Состав для открытого места; `null` — ещё не известен (читается, не прочитался или прочитан для другого места). */
export function groupOf<T>(read: GroupRead<T> | null, place: string): readonly T[] | null {
  return read !== null && read.place === place && read.status === "ready" ? read.members : null;
}

/** Состав этого места прочитан по последней версии плана: до этого выбор участника закрыт (данные могли измениться). */
export function groupFresh<T>(read: GroupRead<T> | null, place: string, version: number): boolean {
  return read !== null && read.place === place && read.status === "ready" && read.version === version;
}

/** Что делать с полосой участников: `pending` — панель держит прежнее, `none` — строки нет (подтверждено), `shown` — показать. */
export function stripState(members: readonly unknown[] | null, failed = false): "pending" | "none" | "shown" {
  if (members === null) return failed ? "none" : "pending";
  return members.length < 2 ? "none" : "shown";
}

/** Последний ответ становится состоянием, только если он на последний запрос (поздний ответ прежнего места отбрасывается). */
export function acceptGroup<T>(current: GroupRead<T> | null, next: GroupRead<T>, latest: Readonly<{ place: string; version: number }>): GroupRead<T> | null {
  return next.place === latest.place && next.version === latest.version ? next : current;
}
