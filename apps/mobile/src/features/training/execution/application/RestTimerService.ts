import type { RestSignalPort, RestTimerStorePort, RestTimersPort } from "../domain/RestTimerPorts.ts";
import { adjustTimer, runningTimers, startTimer, type RestTimer, type RestTimerStart } from "../domain/RestTimerRules.ts";

const defaultId = () => `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * Единственный владелец побочных эффектов таймеров отдыха. Команды выполняются строго по очереди:
 * поздно запланированный сигнал не переживёт более новую команду «Пропустить» или перезапуск.
 * Сначала сигнал и запись, потом изменение видимого списка — ошибка не показывает ложный таймер.
 */
export class RestTimerService implements RestTimersPort {
  private timers: readonly RestTimer[] = [];
  private tail: Promise<unknown> = Promise.resolve();
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

  private async cancelSignal(timer: RestTimer | null | undefined): Promise<void> {
    if (timer?.signalId) await this.signal.cancel(timer.signalId).catch(() => undefined);
  }

  private async scheduleSignal(timer: RestTimer): Promise<string | null> {
    return this.signal.schedule({ endAt: timer.endAt, title: "Отдых окончен",
      body: `${timer.clientName} · ${timer.exerciseName}` }).catch(() => null);
  }

  list(): readonly RestTimer[] {
    return this.timers;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
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
      const { timers, timer, replaced } = startTimer(this.timers, input, this.newId(), this.now());
      await this.cancelSignal(replaced);
      const scheduled = { ...timer, signalId: await this.scheduleSignal(timer) };
      try {
        await this.store.putTimer(scheduled, replaced?.id ?? null);
      } catch (error) {
        await this.cancelSignal(scheduled);
        throw error;
      }
      this.publish(timers.map((item) => item.id === scheduled.id ? scheduled : item));
    });
  }

  adjust(id: string, deltaSec: number): Promise<void> {
    return this.enqueue(async () => {
      const current = this.timers.find((timer) => timer.id === id);
      if (current === undefined) return;
      // §44.9: старый сигнал не должен сработать раньше или позже нового окончания.
      await this.cancelSignal(current);
      const moved = adjustTimer(current, deltaSec, this.now());
      const scheduled = { ...moved, signalId: await this.scheduleSignal(moved) };
      await this.store.putTimer(scheduled, null);
      this.publish(this.timers.map((timer) => timer.id === id ? scheduled : timer));
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
      await this.cancelSignal(current);
      await this.store.removeTimer(id);
      this.publish(this.timers.filter((timer) => timer.id !== id));
    });
  }
}
