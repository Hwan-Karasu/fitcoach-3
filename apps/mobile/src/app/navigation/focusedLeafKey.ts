/** Состояние навигатора в том виде, что нужно для поиска экрана в фокусе (полное и неполное состояния React Navigation). */
export interface NavigationStateLike {
  readonly index?: number;
  readonly routes: readonly Readonly<{ key?: string; state?: NavigationStateLike; params?: unknown }>[];
}

/**
 * Экран в фокусе с учётом вложенных навигаторов (вкладка → стек → экран). `settled: false` — маршрут в фокусе держит вложенный навигатор,
 * открытый с готовым состоянием из параметров (`params.state`, переход по таймеру или уведомлению): React Navigation не сообщает такое
 * начальное состояние родителю до первого действия навигации, поэтому настоящий экран глубже, а `key` — ключ самой вкладки
 * (ADR-056: после перехода по таймеру пропадали строка участников и стрелки недель).
 */
export function focusedLeaf(state: NavigationStateLike): Readonly<{ key: string | undefined; settled: boolean }> {
  const route = state.routes[state.index ?? state.routes.length - 1];
  if (route === undefined) return { key: undefined, settled: true };
  if (route.state !== undefined) return focusedLeaf(route.state);
  return { key: route.key, settled: !hasPendingNestedState(route.params) };
}

/**
 * Ключ экрана, который сейчас в фокусе. Нижняя панель показывает то, что положил именно этот экран: выбор зависит только от состояния
 * навигации, а не от порядка событий фокуса у разных экранов. Если у вложенного экрана ключа нет (навигатор ещё не собран), возвращается
 * `undefined`: лучше ничего не показать, чем чужое.
 */
export function focusedLeafKey(state: NavigationStateLike): string | undefined {
  return focusedLeaf(state).key;
}

function hasPendingNestedState(params: unknown): boolean {
  if (typeof params !== "object" || params === null || !("state" in params)) return false;
  const nested = (params as { state?: unknown }).state;
  return typeof nested === "object" && nested !== null && Array.isArray((nested as { routes?: unknown }).routes);
}
