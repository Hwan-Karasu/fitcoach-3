import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigation, usePreventRemove } from "@react-navigation/native";

/** Отложенный Recovery Draft: очередь завершается перед Back/Cancel и перед публикацией структуры. */
export function useRecoveryDraftSave<T>(write: (value: T) => Promise<void>) {
  const navigation = useNavigation();
  const writer = useRef(write);
  writer.current = write;
  const pending = useRef<{ value: T } | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paused = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const flush = useCallback(async () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const entry = pending.current;
    if (entry === null) { await queue.current; return; }
    pending.current = null;
    const operation = queue.current.catch(() => undefined).then(() => writer.current(entry.value));
    queue.current = operation;
    try { await operation; setError(null); }
    catch (failure) {
      pending.current ??= entry;
      setError("Не удалось сохранить черновик. Изменения на экране — повторите выход или сохранение.");
      throw failure;
    }
  }, []);
  const schedule = useCallback((value: T) => {
    if (paused.current) return;
    pending.current = { value };
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush().catch(() => undefined); }, 800);
  }, [flush]);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    if (!paused.current) void flush().catch(() => undefined);
  }, [flush]);
  usePreventRemove(true, ({ data }) => {
    if (paused.current) { navigation.dispatch(data.action); return; }
    void flush().then(() => navigation.dispatch(data.action)).catch(() => undefined);
  });
  return { schedule, error, flush,
    beforePublish: async () => { await flush(); paused.current = true; },
    resume: () => { paused.current = false; },
  };
}
