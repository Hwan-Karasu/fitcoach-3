import type { PaletteTokens } from "./resolver.ts";

/**
 * Цвет недели как тема поддерева (UI-OWN-039, как в 2.0): акцент — тон недели, фоны и рамки слегка окрашены им.
 * Текст и статусы не меняются; подпись на заливке — тёмная или светлая по контрасту. Только из токенов темы.
 */
type Rgb = readonly [number, number, number];

function rgbOf(color: string): Rgb | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/iu.exec(color);
  return match === null ? null : [parseInt(match[1]!, 16), parseInt(match[2]!, 16), parseInt(match[3]!, 16)];
}

const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;

/** Смесь двух цветов: `amount` — доля второго (0–1). */
export function mix(base: string, tone: string, amount: number): string {
  const a = rgbOf(base);
  const b = rgbOf(tone);
  if (a === null || b === null) return base;
  return hex([0, 1, 2].map((i) => a[i]! + (b[i]! - a[i]!) * amount) as unknown as Rgb);
}

function luminance(color: string): number {
  const rgb = rgbOf(color);
  if (rgb === null) return 0;
  const [r, g, b] = rgb.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as unknown as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

export function tintPalette(tokens: PaletteTokens, tone: string): PaletteTokens {
  // Подпись на заливке — тот из текста/фона темы, что контрастнее с тоном.
  const onAccentFill = contrastRatio(tokens.textPrimary, tone) >= contrastRatio(tokens.canvas, tone) ? tokens.textPrimary : tokens.canvas;
  return {
    ...tokens,
    canvas: mix(tokens.canvas, tone, 0.06),
    surface: mix(tokens.surface, tone, 0.07),
    surfaceRaised: mix(tokens.surfaceRaised, tone, 0.12),
    input: mix(tokens.input, tone, 0.05),
    border: mix(tokens.border, tone, 0.35),
    accentFill: tone,
    onAccentFill,
    accentInk: tone,
    focusRing: tone,
  };
}
