/** Metro can request thousands of cached transforms concurrently during a refresh. */
export function boundedCache<Value>(store: {
  get(key: Buffer): Value | null | Promise<Value | null>;
  set(key: Buffer, value: Value): void | Promise<void>;
  clear(): void | Promise<void>;
}, concurrency = 32) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("INVALID_CACHE_CONCURRENCY");
  let active = 0;
  const waiting: (() => void)[] = [];
  const run = async <T>(operation: () => T | Promise<T>): Promise<T> => {
    if (active >= concurrency) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try { return await operation(); }
    finally {
      const next = waiting.shift();
      if (next) next(); else active -= 1;
    }
  };
  return {
    get: (key: Buffer) => run(() => store.get(key)),
    set: (key: Buffer, value: Value) => run(() => store.set(key, value)),
    clear: () => store.clear(),
  };
}
