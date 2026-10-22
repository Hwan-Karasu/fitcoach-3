/** Состояние навигатора в том виде, что нужно для поиска экрана в фокусе (полное и неполное состояния React Navigation). */
export interface NavigationStateLike {
  readonly index?: number;
  readonly routes: readonly Readonly<{ key?: string; state?: NavigationStateLike }>[];
}

/**
 * Ключ экрана, который сейчас в фокусе, с учётом вложенных навигаторов (вкладка → стек → экран). Нижняя панель показывает то,
 * что положил именно этот экран: выбор зависит только от состояния навигации, а не от порядка событий фокуса у разных экранов.
 * Если у вложенного экрана ключа нет (навигатор ещё не собран), возвращается `undefined`: лучше ничего не показать, чем чужое.
 */
export function focusedLeafKey(state: NavigationStateLike): string | undefined {
  const route = state.routes[state.index ?? state.routes.length - 1];
  if (route === undefined) return undefined;
  return route.state === undefined ? route.key : focusedLeafKey(route.state);
}
