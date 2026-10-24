import { appThemes as catalogThemes } from "./themes.ts";
import { migrateThemePreference } from "./themePreference.ts";
import { readableInk } from "./colorAlpha.ts";

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
  readonly controlBorder: string;
  readonly navigation: string;
  readonly divider: string;
  readonly iconPrimary: string;
  readonly iconSecondary: string;
  readonly textPrimary: string;
  readonly textSecondary: string;
  readonly textMuted: string;
  readonly accentFill: string;
  readonly onAccentFill: string;
  readonly accentInk: string;
  /** Мягкий фон акцента (brandSoft «Зефирки»): второстепенные кнопки, плашки, выбранное. */
  readonly accentSoft: string;
  readonly onAccentSoft: string;
  readonly accentPressed: string;
  readonly focusRing: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  readonly info: string;
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
  const migrated = migrateThemePreference(preference);
  const fallback = findTheme(fallbackThemeId);
  if (!fallback) throw new Error(`Invalid application fallback theme ID: ${fallbackThemeId}`);
  const requested = migrated.themeId === null ? undefined : findTheme(migrated.themeId);
  const theme = requested ?? fallback;
  const accent = findAccent(theme, migrated.accentId) ?? findAccent(theme, theme.accentDefault);
  if (!accent) throw new Error(`Theme catalog has no default accent for ${theme.id}`);
  const backgrounds = [theme.canvas, theme.surface, theme.raised, theme.input, theme.navigation];
  const neutralBackgrounds = [...backgrounds, ...theme.accentSwatches.map((candidate) => candidate.soft)];
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
      controlBorder: theme.iconSecondary,
      // A denser theme surface separates the floating bar from the page and white cards.
      navigation: theme.input,
      divider: theme.divider,
      iconPrimary: theme.iconPrimary,
      iconSecondary: theme.iconSecondary,
      textPrimary: theme.text,
      textSecondary: readableInk(theme.secondary, neutralBackgrounds, theme.text),
      textMuted: readableInk(theme.muted, neutralBackgrounds, theme.text),
      accentFill: accent.hex,
      onAccentFill: accent.resolvedOnFill,
      accentInk: readableInk(accent.resolvedInk, [...backgrounds, accent.soft], theme.text),
      focusRing: accent.focusRing,
      accentSoft: accent.soft,
      onAccentSoft: readableInk(accent.onSoft, [accent.soft], theme.text),
      accentPressed: accent.pressed,
      success: theme.status.success,
      warning: theme.status.warning,
      danger: theme.status.danger,
      info: theme.status.info,
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
