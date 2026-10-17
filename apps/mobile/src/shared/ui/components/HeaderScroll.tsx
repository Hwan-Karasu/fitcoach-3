import { createContext, useCallback, useContext, useRef } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

const HeaderScrollContext = createContext<((scrolled: boolean) => void) | null>(null);

/** Корневая вкладка подписывается, прокручен ли её экран: шапка меняет бренд на название раздела. */
export const HeaderScrollReporter = HeaderScrollContext.Provider;

/** Обработчик `onScroll` для экрана корневой вкладки; сообщает только смену состояния. */
export function useHeaderScrollHandler(threshold = 24) {
  const report = useContext(HeaderScrollContext);
  const scrolled = useRef(false);
  return useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y > threshold;
    if (next === scrolled.current) return;
    scrolled.current = next;
    report?.(next);
  }, [report, threshold]);
}
