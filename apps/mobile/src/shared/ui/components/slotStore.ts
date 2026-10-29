/**
 * Небольшое внешнее хранилище «ключ → значение» для `useSyncExternalStore`: экраны кладут в него своё содержимое для нижней панели
 * навигации, панель читает значение экрана, который сейчас в фокусе. Снимок неизменяемый и меняется только при реальном изменении.
 */
export function createSlotStore<T>() {
  let snapshot: ReadonlyMap<string, T> = new Map();
  const listeners = new Set<() => void>();
  const commit = (next: Map<string, T>) => { snapshot = next; listeners.forEach((listener) => listener()); };
  return {
    get: (key: string | undefined): T | undefined => key === undefined ? undefined : snapshot.get(key),
    set: (key: string, value: T) => {
      if (snapshot.get(key) === value) return;
      const next = new Map(snapshot); next.set(key, value); commit(next);
    },
    remove: (key: string) => {
      if (!snapshot.has(key)) return;
      const next = new Map(snapshot); next.delete(key); commit(next);
    },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
  };
}

export type SlotStore<T> = ReturnType<typeof createSlotStore<T>>;

/** Экран объявил, что скоро положит в панель своё содержимое, но оно ещё не готово (грузятся данные). */
export const PENDING: unique symbol = Symbol("tab-bar-slot-pending");

/**
 * Что показать в панели по записи экрана в фокусе: значение; явная пустота (`null`) — ничего; «ожидается» — то, что панель
 * показывала до перехода (кнопки не меняют размер, пока новый экран грузится); записи нет — ничего (экран панель не использует).
 */
export function resolveSlot<T>(raw: T | null | typeof PENDING | undefined, previous: T | undefined): T | undefined {
  if (raw === PENDING) return previous;
  return raw ?? undefined;
}

/** Ключ записи «экран, который сам отметил свой фокус» в хранилище владельца. */
export const FOCUSED_OWNER = "focused";

/**
 * Чьи записи показывать (ADR-056). Состояние навигации знает экран в фокусе (`settled`) — его ключ, как всегда. Не знает: вложенный стек
 * открыт с готовым состоянием из параметров (переход по таймеру) и ещё не сообщил его родителю — тогда экран, который сам отметил свой
 * фокус; без отметки — прежний ключ.
 */
export function slotOwnerKey(leaf: Readonly<{ key: string | undefined; settled: boolean }>, owner: string | undefined): string | undefined {
  return leaf.settled ? leaf.key : owner ?? leaf.key;
}
