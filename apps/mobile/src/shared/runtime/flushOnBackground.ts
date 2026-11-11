/** The slice of React Native `AppState` this rule needs; tests supply their own source. */
export interface AppStateSource {
  addEventListener(type: "change", listener: (state: string) => void): { remove(): void };
}

/**
 * Отложенная запись (пауза после ввода) держится на таймере JS, а в фоне Android таймеры не срабатывают: значение, набранное прямо
 * перед блокировкой экрана, оставалось бы только в памяти до возврата в приложение — и пропадало, если процесс за это время выгружен.
 * Уход из активного состояния дописывает ввод сразу. `flush` сам сообщает об ошибке своему экрану и не должен отклонять промис.
 */
export function flushOnBackground(appState: AppStateSource, flush: () => unknown): () => void {
  const subscription = appState.addEventListener("change", (state) => { if (state !== "active") void flush(); });
  return () => subscription.remove();
}
