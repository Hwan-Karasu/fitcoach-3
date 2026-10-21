import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { shadow } from "../theme/style.ts";

interface SegmentItem<Id extends string> {
  readonly id: Id;
  readonly label: string;
}

/** Переключатель из 2–3 равных сегментов во всю ширину (UI-OWN-026); «Зефирка»: дорожка, выбранный — белый с тенью. */
export function SegmentedControl<Id extends string>({ items, selectedId, onSelect, compact = false, fit = false, scroll = false }: Readonly<{
  items: readonly SegmentItem<Id>[];
  selectedId: Id;
  onSelect: (id: Id) => void;
  /** Четыре и более пункта: ниже, мельче шрифт, подпись ужимается, а не обрезается. */
  compact?: boolean;
  /** Подписи разной длины: ширина сегмента — по тексту, свободное место делится поровну; шрифт ужимается, а не обрезается. */
  fit?: boolean;
  /** Много пунктов: один контейнер с горизонтальной прокруткой, сегменты по ширине подписи. */
  scroll?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const segments = items.map((item) => {
    const selected = item.id === selectedId;
    return (
      <Pressable key={item.id} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={item.label}
        onPress={() => onSelect(item.id)}
        style={[styles.segment, fit ? styles.segmentFit : null, scroll ? styles.segmentScroll : null, compact ? styles.segmentCompact : null, selected ? [shadow.control, { backgroundColor: colors.surface }] : null]}>
        <Text numberOfLines={1} adjustsFontSizeToFit={(compact || fit) && !scroll} minimumFontScale={0.85} style={[styles.label, compact ? styles.labelCompact : null, selected ? styles.selected : null, { color: selected ? colors.accentInk : colors.textSecondary }]}>{item.label}</Text>
      </Pressable>
    );
  });
  return (
    <View accessibilityRole="tablist" style={[styles.track, compact ? styles.trackCompact : null, { backgroundColor: colors.border }]}>
      {scroll ? <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scrollContent}>{segments}</ScrollView> : segments}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", height: 48, borderRadius: 16, padding: 4, gap: 4 },
  segment: { flex: 1, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  segmentFit: { flexGrow: 1, flexShrink: 1, flexBasis: "auto", paddingHorizontal: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 19 },
  selected: { fontFamily: fonts.bold },
  segmentScroll: { flex: 0, paddingHorizontal: 12 },
  scrollContent: { gap: 2 },
  trackCompact: { height: 44, borderRadius: 14, padding: 3, gap: 2 },
  segmentCompact: { borderRadius: 11, paddingHorizontal: 2 },
  labelCompact: { fontSize: 13, lineHeight: 17 },
});
