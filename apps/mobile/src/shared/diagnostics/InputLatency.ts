/**
 * Только для замеров разработчика (INPUT-LAG-1), в памяти процесса, только в `__DEV__`: сколько проходит от `onChangeText` ячейки до
 * её следующей отрисовки с новым текстом. Значения ячеек, идентификаторы и имена не сохраняются — только длительности.
 */
declare const __DEV__: boolean;
const enabled = typeof __DEV__ !== "undefined" && __DEV__;
let started: number | null = null;
const samples: number[] = [];

export const inputLatency = {
  /** Вызывается в `onChangeText`. */
  begin(): void { if (enabled) started = performance.now(); },
  /** Вызывается после отрисовки ячейки с новым текстом. */
  end(): void {
    if (!enabled || started === null) return;
    samples.push(performance.now() - started);
    started = null;
    if (samples.length > 500) samples.shift();
  },
  reset(): void { samples.length = 0; started = null; },
  /** Перцентили в мс; пусто — `null`. */
  stats(): Readonly<{ count: number; p50: number; p95: number; max: number }> | null {
    if (samples.length === 0) return null;
    const sorted = [...samples].sort((a, b) => a - b);
    const at = (share: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))]!;
    return { count: sorted.length, p50: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1]! };
  },
};
