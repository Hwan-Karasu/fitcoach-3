import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { flushOnBackground } from "../../runtime/flushOnBackground.ts";

/** Дописывает отложенный ввод экрана, когда приложение сворачивают или блокируют экран (см. `flushOnBackground`). */
export function useFlushOnBackground(flush: () => unknown): void {
  const latest = useRef(flush);
  latest.current = flush;
  useEffect(() => flushOnBackground(AppState, () => latest.current()), []);
}
