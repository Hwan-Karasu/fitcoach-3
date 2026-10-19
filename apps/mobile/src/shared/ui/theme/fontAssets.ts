import { Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from "@expo-google-fonts/manrope";
import type { fonts } from "./typography.ts";

/** Файлы шрифтов для `useFonts`; отдельно от `typography.ts`, чтобы тесты в Node не грузили .ttf. */
export const fontAssets: Readonly<Record<(typeof fonts)[keyof typeof fonts], number>> = {
  Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
};
