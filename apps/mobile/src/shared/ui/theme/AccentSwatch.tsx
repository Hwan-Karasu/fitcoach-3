import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { catalogThemes } from "./catalog.generated.ts";
import type { PaletteTokens } from "./resolver.ts";

type CatalogTheme = typeof catalogThemes[number];
type Accent = CatalogTheme["accentSwatches"][number];

export function AccentSwatch({
  accent,
  selected,
  palette,
  onPress,
}: Readonly<{
  accent: Accent;
  selected: boolean;
  palette: PaletteTokens;
  onPress: () => void;
}>) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Акцент ${accent.name}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.choice, {
        backgroundColor: pressed ? palette.surfaceRaised : palette.surface,
        borderColor: focused || selected ? palette.focusRing : palette.border,
      }]}
      testID={`accent-${accent.id}`}
    >
      <View style={[styles.dot, { backgroundColor: accent.hex, borderColor: palette.border }]} />
      <Text style={[styles.name, { color: palette.textPrimary }]}>{accent.name}</Text>
      <Text style={[styles.check, { color: palette.accentInk }]}>{selected ? "✓" : ""}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: { minHeight: 52, borderRadius: 8, borderWidth: 2, paddingHorizontal: 12, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 1 },
  name: { flex: 1, flexShrink: 1, fontSize: 14, lineHeight: 20, fontWeight: "700" },
  check: { minWidth: 20, fontSize: 16, lineHeight: 22, fontWeight: "700", textAlign: "center" },
});
