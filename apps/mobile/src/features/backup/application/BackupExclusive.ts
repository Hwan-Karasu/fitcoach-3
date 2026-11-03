/** Одна операция копирования за раз на весь процесс (BKP-LOCK-1): ручная копия, экспорт и автокопия (с её ротацией) не идут
 * параллельно — две копии сразу удваивали нагрузку на JS-поток и время. Политика: ручная копия ждёт идущую автокопию,
 * автокопия при занятой очереди не ждёт, а откладывается (`tryRun` → null). Две ручные копии отсекает сам ManualBackupService. */
export class BackupExclusive {
  private tail: Promise<void> = Promise.resolve();
  private admitted = 0;
  get busy(): boolean { return this.admitted > 0; }
  run<T>(task: () => Promise<T>): Promise<T> {
    this.admitted++;
    const result = this.tail.then(task);
    const settled = result.then(() => undefined, () => undefined).then(() => { this.admitted--; });
    this.tail = settled;
    return result;
  }
  tryRun<T>(task: () => Promise<T>): Promise<T> | null {
    return this.busy ? null : this.run(task);
  }
}
