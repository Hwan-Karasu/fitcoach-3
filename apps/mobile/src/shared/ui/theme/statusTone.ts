import type { PaletteTokens } from "./resolver.ts";

/** Смысл цвета статуса; сам цвет берётся из токенов темы, чтобы экраны не хранили hex. */
export type StatusTone = "success" | "info" | "warning" | "accent" | "neutral";

/** Цвет статуса из токенов темы; нейтральный статус не красится (`null`). */
export function statusToneColor(tone: StatusTone, colors: PaletteTokens): string | null {
  switch (tone) {
    case "success": return colors.success;
    case "info": return colors.info;
    case "warning": return colors.warning;
    case "accent": return colors.accentInk;
    case "neutral": return null;
  }
}
