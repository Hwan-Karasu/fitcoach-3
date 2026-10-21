/**
 * Очередь записей дневника: команды выполняются строго по одной, каждая начинается после завершения предыдущей (ревизия факта
 * берётся из ответа предыдущей, двойное нажатие не дублирует запись). Пока в очереди есть собственные команды, их коммиты уже
 * применены к состоянию через ACK и перечитывать дневник не нужно (`busy`).
 */
export class SerialWriteQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private inFlight = 0;
  private failed = false;

  /** В очереди или выполняется хотя бы одна команда. */
  get busy(): boolean {
    return this.inFlight > 0;
  }

  /** Результат команды; при ошибке — `null`, `onError` вызывается, а `settle()` вернёт `false`. */
  run<T>(task: () => Promise<T>, handlers: Readonly<{ onSuccess?: () => void; onError?: (error: unknown) => void }> = {}): Promise<T | null> {
    this.inFlight += 1;
    const run = this.tail.then(task).then((value) => { handlers.onSuccess?.(); return value; }, (error: unknown) => {
      this.failed = true;
      handlers.onError?.(error);
      return null;
    }).finally(() => { this.inFlight -= 1; });
    this.tail = run;
    return run;
  }

  /** Дожидается всех поставленных команд (в том числе добавленных во время ожидания); `false`, если какая-то не удалась. */
  async settle(): Promise<boolean> {
    let waiting: Promise<unknown>;
    do { waiting = this.tail; await waiting; } while (waiting !== this.tail);
    const saved = !this.failed;
    this.failed = false;
    return saved;
  }
}
