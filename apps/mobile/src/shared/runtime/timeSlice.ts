/** Уступить JS-поток: очередь задач (нажатия, ответы базы, отрисовка) успевает выполниться. */
export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Длинная работа на JS-потоке (хеш резервной копии) порциями по времени, а не по числу строк или байт: поток уступается, когда с
 * прошлой уступки прошло больше `budgetMs`. Порции по счёту на медленном Hermes превращались в секунды полной блокировки
 * (AUTO-BACKUP-1/2: «зависание намертво» во время тренировки).
 */
export function createTimeSlicer(budgetMs = 8, now: () => number = () => performance.now(),
  yieldTask: () => Promise<void> = yieldToEventLoop): () => Promise<void> {
  let since = now();
  return async () => {
    if (now() - since < budgetMs) return;
    await yieldTask();
    since = now();
  };
}
