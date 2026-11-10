/** A targeted params update reaches the nested workout stack without replacing its screen or pending inputs. */
type State = Readonly<{ key?: string; index?: number; routes: readonly Readonly<{ key?: string; state?: State }>[] }>;
export function exerciseFocusAction(state: State | undefined, routeKey: string, exerciseId: string, request: number) {
  if (state === undefined) return null;
  let current = state;
  for (;;) {
    if (current.key !== undefined && current.routes.some((route) => route.key === routeKey)) {
      return { type: "SET_PARAMS", source: routeKey, target: current.key,
        payload: { params: { focusExerciseId: exerciseId, focusExerciseRequest: request } } };
    }
    const child = current.routes[current.index ?? 0]?.state;
    if (child === undefined) return null;
    current = child;
  }
}
