import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { shadow } from "../theme/style.ts";

/**
 * Плавающая кнопка главного действия экрана (UI-OWN-017; «Зефирка»: 60×60, радиус 20, тень акцента), справа внизу. С `text` — широкая,
 * значок и подпись (каталог: «Своё упражнение», UI-OWN-030).
 */
export function FloatingActionButton({ label, icon, onPress, text, compact = false }: Readonly<{
  label: string;
  icon: (color: string) => ReactNode;
  onPress: () => void;
  text?: string;
  /** Меньше обычной: видимая высота 38 (только с `text`), зона нажатия 44 через hitSlop (ADR-014). */
  compact?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      hitSlop={compact && text !== undefined ? { top: 5, bottom: 5, left: 4, right: 4 } : undefined}
      style={({ pressed }) => [styles.fab, shadow.fab, text !== undefined ? styles.extended : null, compact && text !== undefined ? styles.compact : null,
        { backgroundColor: colors.accentFill, opacity: pressed ? 0.85 : 1 }]}>
      {icon(colors.onAccentFill)}
      {text !== undefined ? <Text numberOfLines={1} style={[styles.text, compact ? styles.textCompact : null, { color: colors.onAccentFill }]}>{text}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute", right: 20, bottom: 16, width: 60, height: 60, borderRadius: 20, alignItems: "center", justifyContent: "center",
  },
  extended: { width: undefined, height: 52, borderRadius: 18, flexDirection: "row", gap: 8, paddingLeft: 16, paddingRight: 20 },
  compact: { height: 38, borderRadius: 13, gap: 5, paddingLeft: 12, paddingRight: 14, bottom: 14 },
  text: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18 },
  textCompact: { fontSize: 13, lineHeight: 16 },
});
