import type { ReactNode } from "react";
import { View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/**
 * Сплошная рамка вокруг упражнений суперсета: объединяет карточки в одну группу. Без анимации и SVG — прокрутка
 * программы остаётся плавной.
 */
export function SupersetBorder({ radius, gap = 0, thickness = 2, children }: Readonly<{
  radius: number; gap?: number; thickness?: number; children: ReactNode;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <View style={{ padding: thickness + 1, gap, borderWidth: thickness, borderRadius: radius + thickness, borderColor: colors.accentInk }}>
      {children}
    </View>
  );
}
