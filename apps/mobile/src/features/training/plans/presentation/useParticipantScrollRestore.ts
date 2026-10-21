import { useEffect, useRef } from "react";

/** Сколько ждать роста страницы нового участника: если размер так и не изменился, прокрутка и так на месте. */
const RESTORE_WAIT_MS = 1200;

/**
 * Возврат позиции прокрутки экрана программы при смене участника: страница нового участника может быть короче (меньше
 * мезоциклов) или достраиваться (недели, статусы), поэтому позиция возвращается при каждом изменении размера страницы,
 * пока она не станет достижимой. Смена мезоцикла у того же участника сюда не относится: страница и позиция остаются как есть.
 */
export function useParticipantScrollRestore({ currentKey, stale, scrollTo }: Readonly<{
  /** Чьи данные запрошены (`клиент:программа`). */
  currentKey: string;
  /** Данные запрошенного участника ещё не загружены — страницу не трогаем. */
  stale: boolean;
  scrollTo: (y: number) => void;
}>) {
  const lastY = useRef(0);
  const pending = useRef<number | null>(null);
  const shownKey = useRef(currentKey);
  useEffect(() => {
    if (shownKey.current === currentKey) return;
    shownKey.current = currentKey;
    pending.current = lastY.current;
  }, [currentKey]);
  useEffect(() => {
    if (stale || pending.current === null) return undefined;
    const timer = setTimeout(() => { pending.current = null; }, RESTORE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [currentKey, stale]);
  return {
    onScroll: (y: number) => { lastY.current = y; },
    onContentSizeChange: (height: number) => {
      if (stale || pending.current === null) return;
      const y = pending.current;
      scrollTo(y);
      if (height > y) pending.current = null;
    },
  };
}
