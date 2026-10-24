import type { PaletteTokens } from "./resolver.ts";
import { contrastRatio, mix, readableInk } from "./colorAlpha.ts";

export { contrastRatio, mix };

/**
 * Цвет недели как тема поддерева (UI-OWN-039, как в 2.0): акцент — тон недели, фоны и рамки слегка окрашены им.
 * Текст и статусы не меняются; подпись на заливке — тёмная или светлая по контрасту. Только из токенов темы.
 */
export function tintPalette(tokens: PaletteTokens, tone: string): PaletteTokens {
  // Подпись на заливке — тот из текста/фона темы, что контрастнее с тоном.
  const onAccentFill = contrastRatio(tokens.textPrimary, tone) >= contrastRatio(tokens.canvas, tone) ? tokens.textPrimary : tokens.canvas;
  const tinted = {
    ...tokens,
    canvas: mix(tokens.canvas, tone, 0.06),
    surface: mix(tokens.surface, tone, 0.07),
    surfaceRaised: mix(tokens.surfaceRaised, tone, 0.12),
    input: mix(tokens.input, tone, 0.05),
    navigation: mix(tokens.navigation, tone, 0.07),
    border: mix(tokens.border, tone, 0.35),
    accentFill: tone,
    accentPressed: mix(tone, onAccentFill, 0.12),
    onAccentFill,
    accentInk: tone,
    focusRing: tone,
    accentSoft: mix(tokens.surface, tone, 0.14),
    onAccentSoft: tone,
  };
  const backgrounds = [tinted.canvas, tinted.surface, tinted.surfaceRaised, tinted.input, tinted.navigation, tinted.accentSoft];
  const ink = readableInk(tone, backgrounds, tokens.textPrimary);
  return { ...tinted, accentInk: ink, onAccentSoft: ink };
}
