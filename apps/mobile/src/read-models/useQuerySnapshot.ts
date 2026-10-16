import { useSyncExternalStore } from "react";
import type { QueryHandle, QuerySnapshot } from "./QueryRegistry.ts";

/** Scoped screen subscription; the handle is supplied by its feature controller. */
export function useQuerySnapshot<T>(handle: QueryHandle<T>): QuerySnapshot<T> {
  return useSyncExternalStore(handle.subscribe, handle.getSnapshot, handle.getSnapshot);
}
