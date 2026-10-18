import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

interface SegmentItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

/** Переключатель из 2–3 равных сегментов во всю ширину (вкладки «Программа | Шаблоны» конструктора, UI-OWN-026). */
export function SegmentedControl<Id extends string>({ items, selectedId, onSelect }: Readonly<{
  items: readonly SegmentItem<Id>[];
  selectedId: Id;
  onSelect: (id: Id) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View accessibilityRole="tablist" style={[styles.track, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label}
            onPress={() => onSelect(item.id)} hitSlop={{ top: 3, bottom: 3 }}
            style={[styles.segment, { backgroundColor: selected ? colors.accentFill : "transparent" }]}>
            <Text numberOfLines={1} style={[styles.label, { color: selected ? colors.onAccentFill : colors.textSecondary }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", borderWidth: 1, borderRadius: 12, padding: 3, gap: 3 },
  segment: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
});
