import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { catalogThemes } from "./catalog.generated.ts";
import { fonts } from "./typography.ts";

type CatalogTheme = typeof catalogThemes[number];

export function ThemeCard({
  theme,
  selected,
  selectedAccentId,
  onPress,
}: Readonly<{ theme: CatalogTheme; selected: boolean; selectedAccentId?: string; onPress: () => void }>) {
  const [focused, setFocused] = useState(false);
  const previewAccent = theme.accentSwatches.find(
    (accent) => accent.id === (selectedAccentId ?? theme.accentDefault),
  ) ?? theme.accentSwatches[0];
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Тема ${theme.name}`}
      accessibilityHint="Выбрать тему и показать её совместимые акценты"
      accessibilityState={{ selected }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.card, {
        backgroundColor: pressed ? theme.raised : theme.surface,
        borderColor: focused || selected ? previewAccent.resolvedInk : theme.border,
      }]}
      testID={`theme-${theme.id}`}
    >
      <View style={styles.top}>
        <View style={styles.nameColumn}>
          <Text style={[styles.name, { color: theme.text }]}>{theme.name}</Text>
          <Text style={[styles.tone, { color: theme.secondary }]}>
            {theme.tone === "dark" ? "Тёмная схема" : "Светлая схема"}
          </Text>
        </View>
        <Text style={[styles.selectedText, { color: previewAccent.resolvedInk }]}>
          {selected ? "✓ Выбрана" : "Выбрать"}
        </Text>
      </View>
      <View style={styles.swatches} accessible={false}>
        <View style={[styles.surfaceSwatch, { backgroundColor: theme.canvas, borderColor: theme.border }]} />
        <View style={[styles.surfaceSwatch, { backgroundColor: theme.raised, borderColor: theme.border }]} />
        {theme.accentSwatches.map((accent) => (
          <View key={accent.id} style={[styles.colorSwatch, { backgroundColor: accent.hex, borderColor: theme.border }]} />
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 96, borderWidth: 2, borderRadius: 12, padding: 12, gap: 12 },
  top: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  nameColumn: { flex: 1, flexShrink: 1, gap: 3 },
  name: { fontSize: 16, lineHeight: 22, fontFamily: fonts.bold },
  tone: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  selectedText: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, flexShrink: 1, textAlign: "right" },
  swatches: { flexDirection: "row", alignItems: "center", gap: 8 },
  surfaceSwatch: { width: 32, height: 20, borderRadius: 5, borderWidth: 1 },
  colorSwatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 1 },
});
