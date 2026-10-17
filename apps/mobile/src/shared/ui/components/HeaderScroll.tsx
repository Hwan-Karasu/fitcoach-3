import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";

const HeaderScrollContext = createContext<((scrolled: boolean) => void) | null>(null);

/** Корневая вкладка подписывается, прокручен ли её экран: шапка меняет бренд на название раздела. */
export const HeaderScrollReporter = HeaderScrollContext.Provider;

/**
 * Обработчик `onScroll` для экрана корневой вкладки. Сообщает положение при каждом событии — повторы
 * отсекает вкладка; своей памяти у экрана нет, поэтому после перерисовки шапка не залипает.
 * Новый экран стоит в начале списка и сразу сообщает об этом. Подключать также к `onScrollEndDrag` и
 * `onMomentumScrollEnd`: при быстром свайпе последнее событие `onScroll` у верха может не прийти.
 */
export function useHeaderScrollHandler(threshold = 24) {
  const report = useContext(HeaderScrollContext);
  useEffect(() => { report?.(false); }, [report]);
  return useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    report?.(event.nativeEvent.contentOffset.y > threshold);
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
