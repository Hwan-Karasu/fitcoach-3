import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { PaletteOverride, usePrototypeTheme } from "./PrototypeThemeProvider.tsx";
import { tintPalette } from "./tintPalette.ts";

const SetTone = createContext<((tone: string | null) => void) | null>(null);

/**
 * Цвет экрана (UI-OWN-039, как в 2.0): цвет типа недели наследуют шапка, экран и нижняя панель. Экран сообщает
 * свой цвет; при уходе с экрана он снимается. Без цвета — обычная тема.
 */
export function ScreenToneProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const [tone, setTone] = useState<string | null>(null);
  const tokens = useMemo(() => tone === null ? null : tintPalette(palette.tokens, tone), [palette.tokens, tone]);
  return <SetTone.Provider value={setTone}><PaletteOverride tokens={tokens}>{children}</PaletteOverride></SetTone.Provider>;
}

/** Сообщить цвет открытого экрана (из токенов темы); `null` — без окраски. */
export function useReportScreenTone(tone: string | null): void {
  const set = useContext(SetTone);
  useFocusEffect(useCallback(() => {
    set?.(tone);
    return () => set?.(null);
  }, [set, tone]));
}
