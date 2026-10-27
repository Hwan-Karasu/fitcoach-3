import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigation, usePreventRemove } from "@react-navigation/native";
import { RecoveryDraftQueue } from "../domain/RecoveryDraftQueue.ts";

export function useRecoveryDraftSave<T>(write: (value: T) => Promise<void>, options?: Readonly<{
  hasDraft: boolean; remove: () => Promise<void>; busy?: boolean;
}>) {
  const navigation = useNavigation();
  const writer = useRef(write); writer.current = write;
  const settings = useRef(options); settings.current = options;
  const [error, setError] = useState<string | null>(null);
  const [exitAction, setExitAction] = useState<Parameters<typeof navigation.dispatch>[0] | null>(null);
  const [exitBusy, setExitBusy] = useState(false);
  const bypass = useRef(false);
  const queue = useRef<RecoveryDraftQueue<T> | null>(null);
  queue.current ??= new RecoveryDraftQueue((value) => writer.current(value), () => setError("Не удалось сохранить черновик. Повторите действие."));
  const flush = useCallback(async () => { await queue.current!.flush(); setError(null); }, []);
  const schedule = useCallback((value: T) => queue.current!.schedule(value), []);
  useEffect(() => () => queue.current!.dispose(), []);
  usePreventRemove(true, ({ data }) => {
    if (bypass.current) { navigation.dispatch(data.action); return; }
    if (settings.current?.busy) return;
    if (settings.current?.hasDraft) { setError(null); setExitAction(data.action); return; }
    void flush().then(() => { bypass.current = true; navigation.dispatch(data.action); }).catch(() => setError("Не удалось сохранить черновик. Повторите выход."));
  });
  const leave = async (discard: boolean) => {
    if (!exitAction || exitBusy) return;
    setExitBusy(true); setError(null);
    try {
      if (discard) await queue.current!.discard(() => settings.current!.remove()); else await queue.current!.publish();
      bypass.current = true; const action = exitAction; setExitAction(null); navigation.dispatch(action);
    } catch { setError(discard ? "Не удалось удалить черновик. Попробуйте ещё раз." : "Не удалось сохранить черновик. Попробуйте ещё раз."); }
    finally { setExitBusy(false); }
  };
  return { schedule, flush, error, exitVisible: exitAction !== null, exitBusy,
    cancelExit: () => setExitAction(null), saveAndLeave: () => { void leave(false); }, discardAndLeave: () => { void leave(true); },
    beforePublish: async () => { await queue.current!.publish(); bypass.current = true; },
    discard: async (remove: () => Promise<void>) => { await queue.current!.discard(remove); bypass.current = true; },
    resume: () => { queue.current!.resume(); bypass.current = false; },
  };
}
