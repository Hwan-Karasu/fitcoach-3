import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

/** One compact row of mutually exclusive form values, including long two-line labels. */
export function ChoiceSegments<Id extends string>({ label, items, value, onChange, disabled = false }: Readonly<{
  label: string; items: readonly Readonly<{ id: Id; label: string }>[]; value: Id;
  onChange: (id: Id) => void; disabled?: boolean;
}>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  return <View accessibilityRole="radiogroup" accessibilityLabel={label}
    style={[styles.track, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
    {items.map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.label}
      accessibilityState={{ checked: value === item.id, disabled }} disabled={disabled} onPress={() => onChange(item.id)}
      style={({ pressed }) => [styles.item, { backgroundColor: value === item.id ? colors.accentFill : "transparent",
        opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.label, { color: value === item.id ? colors.onAccentFill : colors.textSecondary }]}>{item.label}</Text>
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 3, gap: 2 },
  item: { flex: 1, minWidth: 0, minHeight: 34, borderRadius: 9, paddingHorizontal: 2, paddingVertical: 3, justifyContent: "center" },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, textAlign: "center" },
});
