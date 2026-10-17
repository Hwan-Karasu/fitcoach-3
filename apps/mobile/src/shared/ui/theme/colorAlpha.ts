/** Токен темы `#RRGGBB` с прозрачностью 0–1 → `#RRGGBBAA`: мягкие фоны строк без новых hex в экранах. */
export function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/iu.test(color)) return color;
  const channel = Math.round(Math.min(1, Math.max(0, alpha)) * 255);
  return `${color}${channel.toString(16).padStart(2, "0")}`;
}
