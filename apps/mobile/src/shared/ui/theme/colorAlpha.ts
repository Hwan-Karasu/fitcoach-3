/** Токен темы `#RRGGBB` с прозрачностью 0–1 → `#RRGGBBAA`: мягкие фоны строк без новых hex в экранах. */
export function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/iu.test(color)) return color;
  const channel = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${color}${channel.toString(16).padStart(2, "0")}`;
}

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

/** Central contrast correction for text roles; original fills stay exactly as supplied. */
export function readableInk(ink: string, backgrounds: readonly string[], target: string, minimum = 4.5): string {
  for (let step = 0; step <= 255; step += 1) {
    const candidate = step === 0 ? ink : mix(ink, target, step / 255);
    if (backgrounds.every((background) => contrastRatio(candidate, background) >= minimum)) return candidate;
  }
  return target;
}
