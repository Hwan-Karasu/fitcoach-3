import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from "@expo-google-fonts/inter";
import type { fonts } from "./typography.ts";

/** Файлы шрифтов для `useFonts`; отдельно от `typography.ts`, чтобы тесты в Node не грузили .ttf. */
export const fontAssets: Readonly<Record<(typeof fonts)[keyof typeof fonts], number>> = {
  Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
};
