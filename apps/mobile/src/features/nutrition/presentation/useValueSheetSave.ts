import { useEffect, useRef, useState } from "react";

/** Сохранение относится к тому открытию листа и дню, с которых начат ввод. */
export function useValueSheetSave(visible: boolean, initial: string, onSave: (text: string) => Promise<string | null>, onClose: () => void, emptyMessage?: string) {
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const session = useRef(0);
  const lock = useRef(false);
  const opened = useRef({ initial, onSave });
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    session.current += 1;
    lock.current = false;
    setBusy(false);
    if (visible) { opened.current = { initial, onSave }; setText(initial); setError(null); }
    return () => { session.current += 1; };
  }, [visible]);
  const submit = async () => {
    if (lock.current || !visible) return;
    if (text.trim() === opened.current.initial.trim()) { close.current(); return; }
    if (text.trim() === "" && emptyMessage !== undefined) { setError(emptyMessage); return; }
    lock.current = true;
    setBusy(true);
    const token = session.current;
    let message: string | null;
    try { message = await opened.current.onSave(text); }
    catch { message = "Не удалось сохранить. Введённое осталось в поле — повторите."; }
    if (token !== session.current) return;
    lock.current = false;
    setBusy(false);
    if (message === null) close.current(); else setError(message);
  };
  return { text, error, busy, submit, change: (value: string) => { setText(value); setError(null); } };
}
