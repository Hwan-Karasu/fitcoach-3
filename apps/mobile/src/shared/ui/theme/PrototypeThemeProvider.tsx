import { createContext, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { appThemes as catalogThemes, DEFAULT_THEME_ID } from "./themes.ts";
import { resolvePalette, type ResolvedPalette, type ThemeId } from "./resolver.ts";
import { normalizeClientCards, type ClientCardPreference } from "../../domain/ClientCardPreference.ts";

const previewFallbackThemeId: ThemeId = DEFAULT_THEME_ID;

interface NavigationAppearance {
  readonly showClientListShortcut: boolean;
  readonly hideNavigationLabels: boolean;
}

interface PrototypeThemeState {
  readonly clientCards: ClientCardPreference;
  readonly setClientCards: (value: Partial<ClientCardPreference>) => void;
  readonly palette: ResolvedPalette;
  readonly dutyColor: string | null;
  readonly setDutyColor: (color: string | null) => void;
  readonly hiddenSessionTypeIds: readonly string[];
  readonly hideSessionType: (id: string) => void;
  readonly navigationAppearance: NavigationAppearance;
  readonly setNavigationAppearance: (key: keyof NavigationAppearance, enabled: boolean) => void;
  readonly selectTheme: (themeId: ThemeId, accentId?: string) => void;
  readonly selectAccent: (accentId: string) => void;
}

const ThemeContext = createContext<PrototypeThemeState | null>(null);

/** Сохранённый выбор; запись вызывает владелец настроек, провайдер хранилища не знает. */
export interface ThemePersistence {
  readonly initial: Readonly<{ themeId: string; accentId: string | null; dutyColor?: string | null; hiddenSessionTypeIds?: readonly string[]; clientCards?: ClientCardPreference } & Partial<NavigationAppearance>> | null;
  readonly onChange: (value: Readonly<{ themeId: string; accentId: string | null; dutyColor?: string | null; hiddenSessionTypeIds?: readonly string[]; clientCards?: ClientCardPreference } & Partial<NavigationAppearance>>) => void;
}

export function PrototypeThemeProvider({ children, persistence }: Readonly<{ children: ReactNode; persistence?: ThemePersistence }>) {
  const initial = persistence?.initial ?? null;
  const [selection, setSelection] = useState(() => {
    const resolved = resolvePalette(initial ?? { themeId: null, accentId: null }, previewFallbackThemeId);
    return { themeId: resolved.themeId, accentId: resolved.accentId,
      showClientListShortcut: initial?.showClientListShortcut === true,
      hideNavigationLabels: initial?.hideNavigationLabels === true,
      dutyColor: initial?.dutyColor ?? null,
      hiddenSessionTypeIds: initial?.hiddenSessionTypeIds ?? [] as readonly string[],
      clientCards: normalizeClientCards(initial?.clientCards) };
  });
  const { themeId, accentId } = selection;
  const latestSelection = useRef(selection);
  const onChange = persistence?.onChange;
  const palette = useMemo(
    () => resolvePalette({ themeId, accentId }, previewFallbackThemeId),
    [themeId, accentId],
  );
  const navigationAppearance = useMemo<NavigationAppearance>(() => ({
    showClientListShortcut: selection.showClientListShortcut, hideNavigationLabels: selection.hideNavigationLabels,
  }), [selection.showClientListShortcut, selection.hideNavigationLabels]);

  const value = useMemo<PrototypeThemeState>(() => ({
    clientCards: selection.clientCards,
    setClientCards: (patch) => {
      latestSelection.current = { ...latestSelection.current, clientCards: normalizeClientCards({ ...latestSelection.current.clientCards, ...patch }) };
      setSelection(latestSelection.current);
      onChange?.(latestSelection.current);
    },
    palette,
    dutyColor: selection.dutyColor,
    hiddenSessionTypeIds: selection.hiddenSessionTypeIds,
    hideSessionType: (id) => {
      latestSelection.current = { ...latestSelection.current, hiddenSessionTypeIds: [...new Set([...latestSelection.current.hiddenSessionTypeIds, id])] };
      setSelection(latestSelection.current);
      onChange?.(latestSelection.current);
    },
    setDutyColor: (color) => {
      if (color !== null && !/^#[0-9a-f]{6}$/iu.test(color)) return;
      latestSelection.current = { ...latestSelection.current, dutyColor: color };
      setSelection(latestSelection.current);
      onChange?.(latestSelection.current);
    },
    navigationAppearance,
    setNavigationAppearance: (key, enabled) => {
      latestSelection.current = { ...latestSelection.current, [key]: enabled };
      setSelection(latestSelection.current);
      onChange?.(latestSelection.current);
    },
    selectTheme: (nextThemeId, nextAccentId) => {
      const theme = catalogThemes.find((candidate) => candidate.id === nextThemeId);
      if (!theme) return;
      const accent = theme.accentSwatches.find((candidate) => candidate.id === nextAccentId);
      latestSelection.current = { ...latestSelection.current, themeId: theme.id, accentId: accent?.id ?? theme.accentDefault };
      setSelection(latestSelection.current);
      onChange?.(latestSelection.current);
    },
    selectAccent: (nextAccentId) => {
      const theme = catalogThemes.find((candidate) => candidate.id === latestSelection.current.themeId);
      if (theme?.accentSwatches.some((candidate) => candidate.id === nextAccentId)) {
        latestSelection.current = { ...latestSelection.current, themeId: theme.id, accentId: nextAccentId };
        setSelection(latestSelection.current);
        onChange?.(latestSelection.current);
      }
    },
  }), [palette, themeId, navigationAppearance, selection.dutyColor, selection.hiddenSessionTypeIds, selection.clientCards, onChange]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function usePrototypeTheme(): PrototypeThemeState {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("Prototype theme provider is missing");
  return context;
}

/**
 * Палитра поддерева подменена (цвет недели, UI-OWN-039): дочерние экраны получают ту же тему с другими токенами.
 * `tokens === null` — без подмены.
 */
export function PaletteOverride({ tokens, children }: Readonly<{ tokens: ResolvedPalette["tokens"] | null; children: ReactNode }>) {
  const parent = usePrototypeTheme();
  const value = useMemo<PrototypeThemeState>(() => tokens === null ? parent : { ...parent, palette: { ...parent.palette, tokens } },
    [parent, tokens]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
