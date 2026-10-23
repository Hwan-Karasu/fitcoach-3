export class RuntimeBusyError extends Error {
  readonly code = "RUNTIME_MAINTENANCE";
  constructor() { super("RUNTIME_MAINTENANCE"); }
}
/** Track whole public operations, including awaits between their SQL calls. Quiescing just
 * the writer is too late: an admitted workflow can still be reading before it queues a write. */
export class RuntimeCommandGate {
  private accepting = true;
  private readonly pending = new Set<Promise<unknown>>();
  pause(): void { this.accepting = false; }
  resume(): void { this.accepting = true; }
  run<T>(task: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new RuntimeBusyError());
    const running = Promise.resolve().then(task);
    this.pending.add(running);
    void running.then(() => this.pending.delete(running), () => this.pending.delete(running));
    return running;
  }
  async idle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }
  /** Ports expose async operations, plus explicitly synchronous read/subscription methods.
   * Synchronous observers remain usable for unmount cleanup; async methods always return
   * a Promise, including a rejected admission, so existing catch handlers keep working. */
  port<T extends object>(target: T, synchronous: readonly PropertyKey[] = []): T {
    const sync = new Set<PropertyKey>(["subscribe", "subscribeCommittedChanges", ...synchronous]);
    const methods = new Map<PropertyKey, unknown>();
    return new Proxy(target, { get: (object, key) => {
      const value: unknown = Reflect.get(object, key, object);
      if (typeof value !== "function") return value;
      if (!methods.has(key)) methods.set(key, sync.has(key) ? value.bind(object)
        : (...args: unknown[]) => this.run(() => Reflect.apply(value, object, args) as Promise<unknown>));
      return methods.get(key);
    } });
  }
}
