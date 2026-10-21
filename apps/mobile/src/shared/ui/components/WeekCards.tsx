import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export interface WeekCardItem {
  readonly index: number;
  readonly caption?: string | null;
  readonly status?: string;
  /** Цвет типа недели (точка у подписи); без него точки нет. */
  readonly tone?: string | null;
}

/** Общая лента недель программы и дневника; выбранная карточка остаётся в поле зрения. */
export function WeekCards({ weeks, selected, onSelect, disabled = false, compact = false }: Readonly<{
  weeks: readonly WeekCardItem[]; selected: number; onSelect: (index: number) => void; disabled?: boolean;
  /** Ниже и прямоугольнее: название и статус в одной строке, подпись типа под ними, шрифты меньше. */
  compact?: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const scroll = useRef<ScrollView>(null);
  const positions = useRef(new Map<number, number>());
  useEffect(() => { scroll.current?.scrollTo({ x: positions.current.get(selected) ?? 0, animated: true }); }, [selected]);
  return <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
    {weeks.map((week) => <Pressable key={week.index} accessibilityRole="button"
      accessibilityLabel={`Неделя ${week.index}${week.caption ? `, ${week.caption}` : ""}${week.status ? `, ${week.status}` : ""}`}
      accessibilityState={{ selected: selected === week.index, disabled }} disabled={disabled}
      onLayout={(event) => {
        positions.current.set(week.index, event.nativeEvent.layout.x);
        if (week.index === selected) scroll.current?.scrollTo({ x: event.nativeEvent.layout.x, animated: false });
      }}
      onPress={() => onSelect(week.index)} style={[styles.card, compact ? styles.cardCompact : null, {
        backgroundColor: selected === week.index ? colors.surface : colors.surfaceRaised,
        borderColor: selected === week.index ? colors.accentInk : "transparent", opacity: disabled ? 0.6 : 1,
      }]}>
      {compact ? <View style={styles.headRow}>
        <Text numberOfLines={1} style={[styles.title, styles.titleCompact, { color: colors.textPrimary }]}>Неделя {week.index}</Text>
        {week.status ? <Text numberOfLines={1} style={[styles.status, styles.statusCompact, { color: selected === week.index ? colors.accentInk : colors.textSecondary }]}>{week.status}</Text> : null}
      </View> : <Text style={[styles.title, { color: colors.textPrimary }]}>Неделя {week.index}</Text>}
      {week.caption ? <View style={styles.captionRow}>
        {week.tone ? <View style={[styles.dot, { backgroundColor: week.tone }]} /> : null}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.caption, compact ? styles.captionCompact : null, styles.grow, { color: colors.textSecondary }]}>{week.caption}</Text>
      </View> : null}
      {week.status && !compact ? <Text style={[styles.status, { color: selected === week.index ? colors.accentInk : colors.textSecondary }]}>{week.status}</Text> : null}
    </Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingBottom: 2 },
  card: { width: 136, minHeight: 64, borderWidth: 2, borderRadius: 16, padding: 12, gap: 5 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17 },
  status: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  cardCompact: { width: 150, minHeight: 0, borderRadius: 12, borderWidth: 1.5, paddingVertical: 6, paddingHorizontal: 10, gap: 2 },
  headRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 6 },
  titleCompact: { fontSize: 13, lineHeight: 17 },
  statusCompact: { fontSize: 11, lineHeight: 15, flexShrink: 1 },
  captionCompact: { fontSize: 12, lineHeight: 15 },
  captionRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  grow: { flexShrink: 1 },
});
