/**
 * Только для замеров разработчика (REST-PERF-1), в памяти процесса: сколько таймеров отдыха на панели и выключен ли покадровый отсчёт
 * цифр. С выключенным отсчётом панель показывает остаток на момент перерисовки — так замер «с таймерами / без обновления цифр»
 * отделяет стоимость отсчёта от остального. Данные таймеров, сигналы и уведомления не меняются.
 */
let clockDisabled = false;
let active = 0;
let measuring = false;
let renders: Record<string, number> = {};
const listeners = new Set<() => void>();

export const restTimerDiagnostics = {
  get clockDisabled(): boolean { return clockDisabled; },
  toggleClock(): boolean { clockDisabled = !clockDisabled; listeners.forEach((listener) => listener()); return clockDisabled; },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; },
  snapshot(): boolean { return clockDisabled; },
  get active(): number { return active; },
  reportActive(count: number): void { active = count; },
  startRenders(): void { renders = {}; measuring = true; },
  render(component: "panel" | "navigation" | "workout" | "timers"): void { if (measuring) renders[component] = (renders[component] ?? 0) + 1; },
  finishRenders(): Readonly<Record<string, number>> { measuring = false; return { ...renders }; },
  /** Метка замера без идентификаторов клиентов: число таймеров и состояние отсчёта. */
  label(base: string): string { return `${base}:timers=${active}:clock=${clockDisabled ? "off" : "on"}`; },
};
