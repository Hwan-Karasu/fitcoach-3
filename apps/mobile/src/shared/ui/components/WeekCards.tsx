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
export function WeekCards({ weeks, selected, onSelect, disabled = false }: Readonly<{
  weeks: readonly WeekCardItem[]; selected: number; onSelect: (index: number) => void; disabled?: boolean;
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
      onPress={() => onSelect(week.index)} style={[styles.card, {
        backgroundColor: selected === week.index ? colors.surface : colors.surfaceRaised,
        borderColor: selected === week.index ? colors.accentInk : "transparent", opacity: disabled ? 0.6 : 1,
      }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Неделя {week.index}</Text>
      {week.caption ? <View style={styles.captionRow}>
        {week.tone ? <View style={[styles.dot, { backgroundColor: week.tone }]} /> : null}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.caption, styles.grow, { color: colors.textSecondary }]}>{week.caption}</Text>
      </View> : null}
      {week.status ? <Text style={[styles.status, { color: selected === week.index ? colors.accentInk : colors.textSecondary }]}>{week.status}</Text> : null}
    </Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingBottom: 2 },
  card: { width: 128, minHeight: 56, borderWidth: 2, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8, gap: 3 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  caption: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17 },
  status: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  captionRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  grow: { flexShrink: 1 },
});
