import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { appThemes as catalogThemes } from "./themes.ts";
import { fonts } from "./typography.ts";

type CatalogTheme = typeof catalogThemes[number];

export function ThemeCard({
  theme,
  selected,
  selectedAccentId,
  onPress,
  onSelectAccent,
}: Readonly<{ theme: CatalogTheme; selected: boolean; selectedAccentId?: string; onPress: () => void;
  onSelectAccent: (accentId: string) => void }>) {
  const [focused, setFocused] = useState(false);
  const previewAccent = theme.accentSwatches.find(
    (accent) => accent.id === (selectedAccentId ?? theme.accentDefault),
  ) ?? theme.accentSwatches[0];
  return (
    <View style={[styles.card, { backgroundColor: theme.surface,
      borderColor: focused || selected ? previewAccent.focusRing : theme.border }]}>
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={`Тема ${theme.name}`}
      accessibilityHint="Применить тему"
      accessibilityState={{ selected }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.preview, {
        backgroundColor: pressed ? theme.raised : theme.canvas,
      }]}
      testID={`theme-${theme.id}`}
    >
      <View style={styles.top}>
        <View style={styles.nameColumn}>
          <Text style={[styles.name, { color: theme.text }]}>{theme.name}</Text>
        </View>
        <Text accessible={false} style={[styles.selectedText, { color: previewAccent.resolvedInk }]}>
          {selected ? "✓" : ""}
        </Text>
      </View>
    </Pressable>
      <View style={styles.swatches}>
        {theme.accentSwatches.map((accent) => {
          const active = selected && accent.id === selectedAccentId;
          return <Pressable key={accent.id} accessibilityRole="radio"
            accessibilityLabel={`${theme.name}, акцент ${accent.name}`} accessibilityState={{ selected: active }}
            onPress={() => onSelectAccent(accent.id)}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            testID={`theme-${theme.id}-accent-${accent.id}`}
            style={({ pressed }) => [styles.accentButton, { opacity: pressed ? 0.7 : 1 }]}>
            <View style={[styles.accentRing, { borderColor: active ? accent.focusRing : "transparent" }]}>
              <View style={[styles.colorSwatch, { backgroundColor: accent.hex }]}>
                {active ? <Text style={[styles.check, { color: accent.resolvedOnFill }]}>✓</Text> : null}
              </View>
            </View>
          </Pressable>;
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, borderWidth: 2, borderRadius: 12, padding: 4 },
  preview: { flex: 1, minHeight: 44, borderRadius: 7, padding: 4, justifyContent: "center" },
  top: { flexDirection: "row", alignItems: "flex-start", gap: 2 },
  nameColumn: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold },
  selectedText: { width: 14, fontSize: 12, lineHeight: 16, fontFamily: fonts.bold, textAlign: "right" },
  swatches: { flexDirection: "row", alignItems: "center" },
  accentButton: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  accentRing: { borderWidth: 2, borderRadius: 17, padding: 3 },
  colorSwatch: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  check: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
});
