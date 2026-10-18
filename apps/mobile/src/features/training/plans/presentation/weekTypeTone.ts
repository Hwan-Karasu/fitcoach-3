import type { PaletteTokens } from "../../../../shared/ui/theme/resolver.ts";
import type { WeekType } from "../domain/PeriodizedModel.ts";

/**
 * Цвет типа недели (UI-OWN-038, как в 2.0): из токенов темы, без своих hex. Его наследуют карточки недель,
 * экран программы и матрица.
 */
export function weekTypeTone(type: WeekType, colors: PaletteTokens): string {
  switch (type) {
    case "base": return colors.accentInk;
    case "light": return colors.success;
    case "medium": return colors.warning;
    case "heavy": return colors.danger;
    case "deload": return colors.charts[1];
  }
}
