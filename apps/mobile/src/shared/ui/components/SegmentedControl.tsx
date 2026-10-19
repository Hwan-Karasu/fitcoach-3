import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { shadow } from "../theme/style.ts";

interface SegmentItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

/** Переключатель из 2–3 равных сегментов во всю ширину (UI-OWN-026); «Зефирка»: дорожка, выбранный — белый с тенью. */
export function SegmentedControl<Id extends string>({ items, selectedId, onSelect }: Readonly<{
  items: readonly SegmentItem<Id>[];
  selectedId: Id;
  onSelect: (id: Id) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View accessibilityRole="tablist" style={[styles.track, { backgroundColor: colors.border }]}>
      {items.map((item) => {
        const selected = item.id === selectedId;
        return (
          <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label}
            onPress={() => onSelect(item.id)}
            style={[styles.segment, selected ? [shadow.control, { backgroundColor: colors.surface }] : null]}>
            <Text numberOfLines={1} style={[styles.label, selected ? styles.selected : null, { color: selected ? colors.accentInk : colors.textSecondary }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", height: 48, borderRadius: 16, padding: 4, gap: 4 },
  segment: { flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19 },
  selected: { fontFamily: fonts.bold },
});
