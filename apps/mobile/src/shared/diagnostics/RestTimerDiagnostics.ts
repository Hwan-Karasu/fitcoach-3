/**
 * Только для замеров разработчика (REST-PERF-1), в памяти процесса: сколько таймеров отдыха на панели и выключен ли секундный отсчёт
 * цифр. С выключенным отсчётом панель показывает остаток на момент перерисовки — так замер «с таймерами / без обновления цифр»
 * отделяет стоимость отсчёта от остального. Данные таймеров, сигналы и уведомления не меняются.
 */
let clockDisabled = false;
let active = 0;
let measuring = false;
let renders: Record<string, number> = {};
let sequence = 0;
const listeners = new Set<() => void>();

export const restTimerDiagnostics = {
  /** Action boundaries only: no names, IDs, exercise data or frame-by-frame logging. */
  event(event: "start" | "persisted" | "start-failed" | "signal" | "signal-ready" | "signal-failed" |
    "clock-mount" | "clock-unmount" | "expanded" | "collapsed" | "hidden" | "gesture-down" | "gesture-up" |
    "active" | "background"): void {
    console.info("[rest-timer]", JSON.stringify({ sequence: ++sequence, event, at: Date.now() }));
  },
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
