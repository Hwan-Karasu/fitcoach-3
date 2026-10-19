/**
 * Семейства Manrope по начертаниям (стиль «Зефирка», UI-OWN-048; было Inter, UI-OWN-007). Шрифты загружаются во
 * время работы, поэтому Android выбирает начертание только по имени семейства: стили задают `fontFamily` отсюда, а не
 * `fontWeight`. В макете начертания 500–800: «regular» — 500, «bold» — 800.
 */
export const fonts = {
  regular: "Manrope_500Medium",
  medium: "Manrope_600SemiBold",
  semibold: "Manrope_700Bold",
  bold: "Manrope_800ExtraBold",
} as const;
