import type { RestSignalPort, RestTimerStorePort, RestTimersPort } from "../domain/RestTimerPorts.ts";
import { adjustTimer, pauseTimer, resumeTimer, runningTimers, startTimer, type RestTimer, type RestTimerStart } from "../domain/RestTimerRules.ts";

const defaultId = () => `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Единственный владелец побочных эффектов таймеров отдыха. Отсчёт показывается и сохраняется сразу;
 * системный сигнал ставится следом и не задерживает экран (загрузка модуля, вопрос о разрешении).
 * Опоздавший сигнал проверяется по актуальному `endAt`: если таймер успели пропустить, перезапустить
 * или сдвинуть, сигнал отменяется — старый сигнал не сработает не вовремя (§44.9).
 */
export class RestTimerService implements RestTimersPort {
  private timers: readonly RestTimer[] = [];
  private tail: Promise<unknown> = Promise.resolve();
  private readonly signalling = new Set<Promise<void>>();
  private readonly listeners = new Set<() => void>();
  private readonly store: RestTimerStorePort;
  private readonly signal: RestSignalPort;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(store: RestTimerStorePort, signal: RestSignalPort, now: () => number = Date.now, newId: () => string = defaultId) {
    this.store = store;
    this.signal = signal;
    this.now = now;
    this.newId = newId;
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  private publish(timers: readonly RestTimer[]): void {
    this.timers = timers;
    for (const listener of this.listeners) {
      try { listener(); } catch { /* Наблюдатель не ломает команду. */ }
    }
  }

  private cancelSignal(signalId: string | null | undefined): Promise<void> {
    return signalId ? this.signal.cancel(signalId).catch(() => undefined) : Promise.resolve();
  }

  /** Поставить сигнал на окончание этого таймера и прежний снять — в фоне, без задержки отсчёта. */
  private attachSignal(timer: RestTimer, previousSignal: string | null): void {
    const task = (async () => {
      await this.cancelSignal(previousSignal);
      const signalId = await this.signal.schedule({ endAt: timer.endAt, title: "Отдых окончен",
        body: `${timer.clientName} · ${timer.exerciseName}`,
        // Только идентификаторы для возврата в тренировку; имена и данные подходов в полезную нагрузку не кладутся (§44.22).
        route: timer.programId === null || timer.weekIndex === null || timer.plannedWorkoutId === null ? { clientId: timer.clientId }
          : { clientId: timer.clientId, programId: timer.programId, weekIndex: timer.weekIndex, plannedWorkoutId: timer.plannedWorkoutId,
            exerciseKey: timer.exerciseKey } }).catch(() => null);
      if (signalId === null) return;
      await this.enqueue(async () => {
        const current = this.timers.find((item) => item.id === timer.id);
        if (current === undefined || current.endAt !== timer.endAt) { await this.cancelSignal(signalId); return; }
        const signalled = { ...current, signalId };
        await this.store.putTimer(signalled, []);
        this.publish(this.timers.map((item) => item.id === timer.id ? signalled : item));
      });
    })().catch(() => undefined);
    this.signalling.add(task);
    void task.finally(() => this.signalling.delete(task));
  }

  list(): readonly RestTimer[] {
    return this.timers;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Дождаться очереди команд и фоновых сигналов (тесты, завершение работы). */
  async idle(): Promise<void> {
    for (;;) {
      const tail = this.tail;
      await tail;
      await Promise.all([...this.signalling]);
      if (tail === this.tail && this.signalling.size === 0) return;
    }
  }

  /** §44.7: идущие таймеры возвращаются с прежним `endAt`, закончившиеся убираются без нового запуска. */
  recover(): Promise<void> {
    return this.enqueue(async () => {
      const stored = await this.store.listTimers();
      const running = runningTimers(stored, this.now());
      for (const timer of stored) if (!running.includes(timer)) await this.store.removeTimer(timer.id);
      this.publish(running);
    });
  }

  start(input: RestTimerStart): Promise<void> {
    return this.enqueue(async () => {
      const before = this.timers;
      const { timers, timer, replaced } = startTimer(before, input, this.newId(), this.now());
      this.publish(timers);
      try {
        await this.store.putTimer(timer, replaced.map((item) => item.id));
      } catch (error) {
        this.publish(before);
        throw error;
      }
      // Прежний таймер заменён: его системный сигнал не должен сработать.
      for (const item of replaced) await this.cancelSignal(item.signalId);
      this.attachSignal(timer, null);
    });
  }

  /** Меняет один таймер: экран обновляется сразу, запись в хранилище при сбое откатывает экран (иначе он разошёлся бы с базой до перезапуска). */
  private async replace(current: RestTimer, next: RestTimer): Promise<void> {
    const before = this.timers;
    this.publish(this.timers.map((timer) => timer.id === current.id ? next : timer));
    try {
      await this.store.putTimer(next, []);
    } catch (error) {
      this.publish(before);
      throw error;
    }
  }

  adjust(id: string, deltaSec: number): Promise<void> {
    return this.enqueue(async () => {
      const current = this.timers.find((timer) => timer.id === id);
      if (current === undefined) return;
      const moved = { ...adjustTimer(current, deltaSec, this.now()), signalId: null };
      await this.replace(current, moved);
      // На паузе сигнала нет: он появится при продолжении.
      if (moved.pausedLeftMs === null) this.attachSignal(moved, current.signalId);
      else await this.cancelSignal(current.signalId);
    });
  }

  pause(id: string): Promise<void> {
    return this.enqueue(async () => {
      const current = this.timers.find((timer) => timer.id === id);
      if (current === undefined) return;
      const paused = pauseTimer(current, this.now());
      if (paused === current) return;
      await this.replace(current, paused);
      await this.cancelSignal(current.signalId);
    });
  }

  resume(id: string): Promise<void> {
    return this.enqueue(async () => {
      const current = this.timers.find((timer) => timer.id === id);
      if (current === undefined) return;
      const resumed = resumeTimer(current, this.now());
      if (resumed === current) return;
      await this.replace(current, resumed);
      this.attachSignal(resumed, null);
    });
  }

  skip(id: string): Promise<void> {
    return this.remove(id);
  }

  dismiss(id: string): Promise<void> {
    return this.remove(id);
  }

  private remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      const current = this.timers.find((timer) => timer.id === id);
      if (current === undefined) return;
      this.publish(this.timers.filter((timer) => timer.id !== id));
      await this.store.removeTimer(id);
      await this.cancelSignal(current.signalId);
    });
  }
}
