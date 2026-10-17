/**
 * Семейства Inter по начертаниям (UI-OWN-007). Шрифты загружаются во время работы, поэтому Android
 * выбирает начертание только по имени семейства: стили задают `fontFamily` отсюда, а не `fontWeight`.
 */
export const fonts = {
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;
