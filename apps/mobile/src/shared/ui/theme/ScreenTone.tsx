import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
export function useReportScreenTone(tone: string | null): (next: string | null) => void {
  const set = useContext(SetTone);
  const current = useRef(tone); current.current = tone;
  const focused = useRef(false);
  useFocusEffect(useCallback(() => {
    focused.current = true; set?.(current.current);
    return () => { focused.current = false; set?.(null); };
  }, [set]));
  // A tone change is not a blur: don't clear the palette and then report it again.
  useLayoutEffect(() => { if (focused.current) set?.(tone); }, [set, tone]);
  return useCallback((next) => { if (focused.current) set?.(next); }, [set]);
}
