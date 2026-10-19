import { mix } from "./colorAlpha.ts";
import { appThemes as catalogThemes } from "./themes.ts";

export type ThemeId = typeof catalogThemes[number]["id"];
export type ThemePreference = Readonly<{ themeId: string | null; accentId: string | null }>;

type CatalogTheme = typeof catalogThemes[number];
type CatalogAccent = CatalogTheme["accentSwatches"][number];

export interface PaletteTokens {
  readonly canvas: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly input: string;
  readonly border: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly accentFill: string;
  readonly onAccentFill: string;
  readonly accentInk: string;
  /** Мягкий фон акцента (brandSoft «Зефирки»): второстепенные кнопки, плашки, выбранное. */
  readonly accentSoft: string;
  readonly focusRing: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly charts: readonly [string, string, string, string];
}

export interface ResolvedPalette {
  readonly themeId: ThemeId;
  readonly accentId: string;
  readonly themeName: string;
  readonly accentName: string;
  readonly tone: "light" | "dark";
  readonly usedThemeFallback: boolean;
  readonly usedAccentFallback: boolean;
  readonly tokens: PaletteTokens;
}

export function resolvePalette(preference: ThemePreference, fallbackThemeId: ThemeId): ResolvedPalette {
  const fallback = findTheme(fallbackThemeId);
  if (!fallback) throw new Error(`Invalid application fallback theme ID: ${fallbackThemeId}`);
  const requested = preference.themeId === null ? undefined : findTheme(preference.themeId);
  const theme = requested ?? fallback;
  const accent = findAccent(theme, preference.accentId) ?? findAccent(theme, theme.accentDefault);
  if (!accent) throw new Error(`Theme catalog has no default accent for ${theme.id}`);
  return {
    themeId: theme.id as ThemeId,
    accentId: accent.id,
    themeName: theme.name,
    accentName: accent.name,
    tone: theme.tone,
    usedThemeFallback: requested === undefined,
    usedAccentFallback: preference.accentId !== accent.id,
    tokens: {
      canvas: theme.canvas,
      surface: theme.surface,
      surfaceRaised: theme.raised,
      input: theme.input,
      border: theme.border,
      textPrimary: theme.text,
      textSecondary: theme.secondary,
      textMuted: theme.muted,
      accentFill: accent.hex,
      onAccentFill: accent.resolvedOnFill,
      accentInk: accent.resolvedInk,
      focusRing: accent.resolvedInk,
      accentSoft: "soft" in accent ? accent.soft : mix(theme.surface, accent.hex, theme.tone === "light" ? 0.13 : 0.22),
      success: theme.status.success,
      warning: theme.status.warning,
      danger: theme.status.danger,
      charts: theme.charts as [string, string, string, string],
    },
  };
}

function findTheme(id: string): CatalogTheme | undefined {
  return catalogThemes.find((theme) => theme.id === id);
}

function findAccent(theme: CatalogTheme, id: string | null): CatalogAccent | undefined {
  if (id === null) return undefined;
  return theme.accentSwatches.find((accent) => accent.id === id) as CatalogAccent | undefined;
}
