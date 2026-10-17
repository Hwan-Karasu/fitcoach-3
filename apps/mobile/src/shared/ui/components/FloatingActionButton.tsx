import type { ReactNode } from "react";
import { Pressable, StyleSheet } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/** Плавающая квадратная кнопка главного действия экрана (UI-OWN-017): 52×52, радиус 10, справа внизу. */
export function FloatingActionButton({ label, icon, onPress }: Readonly<{
  label: string;
  icon: (color: string) => ReactNode;
  onPress: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => [styles.fab, { backgroundColor: colors.accentFill, opacity: pressed ? 0.85 : 1 }]}>
      {icon(colors.onAccentFill)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute", right: 16, bottom: 16, width: 52, height: 52, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
  },
});
