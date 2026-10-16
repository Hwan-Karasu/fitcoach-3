import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { catalogThemes } from "./catalog.generated.ts";
import { resolvePalette, type ResolvedPalette, type ThemeId } from "./resolver.ts";

// Development-only presentation state. The eventual Settings repository owns persistence.
const previewFallbackThemeId: ThemeId = "polar-teal";

interface PrototypeThemeState {
  readonly palette: ResolvedPalette;
  readonly selectTheme: (themeId: ThemeId) => void;
  readonly selectAccent: (accentId: string) => void;
}

const ThemeContext = createContext<PrototypeThemeState | null>(null);

export function PrototypeThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [themeId, setThemeId] = useState<ThemeId>(previewFallbackThemeId);
  const [accentId, setAccentId] = useState<string | null>(null);
  const palette = useMemo(
    () => resolvePalette({ themeId, accentId }, previewFallbackThemeId),
    [themeId, accentId],
  );

  const value = useMemo<PrototypeThemeState>(() => ({
    palette,
    selectTheme: (nextThemeId) => {
      const theme = catalogThemes.find((candidate) => candidate.id === nextThemeId);
      if (!theme) return;
      setThemeId(theme.id);
      setAccentId(theme.accentDefault);
    },
    selectAccent: (nextAccentId) => {
      const theme = catalogThemes.find((candidate) => candidate.id === themeId);
      if (theme?.accentSwatches.some((candidate) => candidate.id === nextAccentId)) {
        setAccentId(nextAccentId);
      }
    },
  }), [palette, themeId]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function usePrototypeTheme(): PrototypeThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Prototype theme provider is missing");
  return context;
}
