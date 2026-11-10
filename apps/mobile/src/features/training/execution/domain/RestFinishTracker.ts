import { isFinished, type RestTimer } from "./RestTimerRules.ts";

/** Ключ одного окончания: продлённый («+15») после окончания таймер заканчивается заново, с другим `endAt`. */
export const finishKey = (timer: Pick<RestTimer, "id" | "endAt">): string => `${timer.id}:${timer.endAt}`;

/**
 * Однократная обработка окончаний (REST-END-1). Окончание замечают несколько источников — таймер JS, возврат из фона, переход
 * изменение списка; каждое окончание отдаётся ровно один раз, сколько бы источников ни сработало.
 * Ушедший из списка таймер забывается: набор не растёт за сессию.
 */
export class RestFinishTracker {
  private readonly seen = new Set<string>();

  observe(list: readonly RestTimer[], now: number): readonly RestTimer[] {
    const present = new Set(list.map(finishKey));
    for (const key of this.seen) if (!present.has(key)) this.seen.delete(key);
    const fresh = list.filter((timer) => isFinished(timer, now) && !this.seen.has(finishKey(timer)));
    for (const timer of fresh) this.seen.add(finishKey(timer));
    return fresh;
  }
}
