import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

/**
 * Плавающая кнопка главного действия экрана (UI-OWN-017): 52×52, радиус 10, справа внизу. С `text` — широкая,
 * значок и подпись (каталог: «Своё упражнение», UI-OWN-030).
 */
export function FloatingActionButton({ label, icon, onPress, text }: Readonly<{
  label: string;
  icon: (color: string) => ReactNode;
  onPress: () => void;
  text?: string;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.fab, text !== undefined ? styles.extended : null,
        { backgroundColor: colors.accentFill, opacity: pressed ? 0.85 : 1 }]}>
      {icon(colors.onAccentFill)}
      {text !== undefined ? <Text numberOfLines={1} style={[styles.text, { color: colors.onAccentFill }]}>{text}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute", right: 16, bottom: 16, width: 52, height: 52, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
  extended: { width: undefined, height: 48, flexDirection: "row", gap: 8, paddingLeft: 14, paddingRight: 18 },
  text: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
});
