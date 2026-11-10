import type { HealthStorePort } from "./HealthPorts.ts";

/** Привязка/отключение и синхронизация не обгоняют друг друга на границах await. Чтения и уведомления не блокируются. */
export function createHealthOperationQueue<T>(store: HealthStorePort, work: () => Promise<T>) {
  let tail: Promise<unknown> = Promise.resolve();
  let running: Promise<T> | null = null;
  const run = <R,>(task: () => Promise<R>): Promise<R> => {
    const result = tail.then(task, task);
    tail = result.catch(() => undefined);
    return result;
  };
  const guarded: HealthStorePort = {
    getLink: () => store.getLink(),
    link: (clientId, now) => run(() => store.link(clientId, now)),
    unlink: () => run(() => store.unlink()),
    listDaily: (clientId, from, to) => store.listDaily(clientId, from, to),
    saveSync: (clientId, values, granted, now) => store.saveSync(clientId, values, granted, now),
    subscribeCommittedChanges: (listener) => store.subscribeCommittedChanges(listener),
  };
  const sync = (): Promise<T> => {
    if (running !== null) return running;
    const result = run(work);
    running = result;
    void result.then(() => { if (running === result) running = null; }, () => { if (running === result) running = null; });
    return result;
  };
  return { store: guarded, sync };
}
