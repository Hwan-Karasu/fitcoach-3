import { createContext, useCallback, useContext, useRef, useState } from "react";
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

export interface HeaderSearchState {
  readonly query: string;
  readonly setQuery: (value: string) => void;
}

const HeaderSearchContext = createContext<HeaderSearchState | null>(null);

/** Поиск корневой вкладки живёт в шапке (UI-OWN-019); экран только читает и сбрасывает текст. */
export const HeaderSearchProvider = HeaderSearchContext.Provider;

/** Текст поиска из шапки; вне корневой вкладки — локальное состояние экрана. */
export function useHeaderSearch(): HeaderSearchState {
  const shared = useContext(HeaderSearchContext);
  const [query, setQuery] = useState("");
  return shared ?? { query, setQuery };
}
