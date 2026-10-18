/** Несохранённый ввод удаляется только после ACK. Повторный flush не дублирует текущую запись. */
export class PendingInputWrites {
  private readonly entries = new Map<string, () => Promise<boolean>>();
  private readonly running = new Map<string, Promise<boolean>>();

  has(key: string): boolean { return this.entries.has(key); }
  set(key: string, save: () => Promise<boolean>): void { this.entries.set(key, save); }

  flush(key: string): Promise<boolean> {
    const running = this.running.get(key);
    if (running) return running.then((saved) => saved && this.entries.has(key) ? this.flush(key) : saved);
    const save = this.entries.get(key);
    if (!save) return Promise.resolve(true);
    const operation = Promise.resolve().then(save).catch(() => false).then((saved) => {
      this.running.delete(key);
      if (saved && this.entries.get(key) === save) this.entries.delete(key);
      return saved;
    });
    this.running.set(key, operation);
    return operation.then((saved) => saved && this.entries.has(key) ? this.flush(key) : saved);
  }

  /** Только записи, ключ которых начинается с префикса (например, ячейки одного подхода). */
  async flushPrefix(prefix: string): Promise<boolean> {
    const keys = [...this.entries.keys()].filter((key) => key.startsWith(prefix));
    const results = await Promise.all(keys.map((key) => this.flush(key)));
    return results.every(Boolean);
  }

  async flushAll(): Promise<boolean> {
    const results = await Promise.all([...this.entries.keys()].map((key) => this.flush(key)));
    return results.every(Boolean) && this.entries.size === 0;
  }
}
