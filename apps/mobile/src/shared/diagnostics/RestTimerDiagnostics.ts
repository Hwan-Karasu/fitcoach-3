/**
 * Только для замеров разработчика (REST-PERF-1), в памяти процесса: сколько таймеров отдыха на панели и выключен ли покадровый отсчёт
 * цифр. С выключенным отсчётом панель показывает остаток на момент перерисовки — так замер «с таймерами / без обновления цифр»
 * отделяет стоимость отсчёта от остального. Данные таймеров, сигналы и уведомления не меняются.
 */
let clockDisabled = false;
let active = 0;

export const restTimerDiagnostics = {
  get clockDisabled(): boolean { return clockDisabled; },
  toggleClock(): boolean { clockDisabled = !clockDisabled; return clockDisabled; },
  get active(): number { return active; },
  reportActive(count: number): void { active = count; },
  /** Метка замера без идентификаторов клиентов: число таймеров и состояние отсчёта. */
  label(base: string): string { return `${base}:timers=${active}:clock=${clockDisabled ? "off" : "on"}`; },
};
