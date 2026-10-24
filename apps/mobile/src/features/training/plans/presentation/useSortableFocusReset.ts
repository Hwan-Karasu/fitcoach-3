import { useLayoutEffect, useRef, useState } from "react";

/** Native sortable measurements must be rebuilt when a detached stack screen becomes visible. */
export function useSortableFocusReset(focused: boolean): number {
  const previous = useRef(focused);
  const [version, setVersion] = useState(0);
  useLayoutEffect(() => {
    if (focused && !previous.current) setVersion((value) => value + 1);
    previous.current = focused;
  }, [focused]);
  return version;
}
