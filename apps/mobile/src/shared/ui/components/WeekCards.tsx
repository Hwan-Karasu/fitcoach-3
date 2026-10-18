import { useEffect, useRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export interface WeekCardItem {
  readonly index: number;
  readonly caption?: string | null;
  readonly status?: string;
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
        backgroundColor: colors.surface, borderColor: selected === week.index ? colors.accentInk : colors.border,
        borderBottomWidth: selected === week.index ? 3 : 1, opacity: disabled ? 0.6 : 1,
      }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Неделя {week.index}</Text>
      {week.caption ? <Text style={[styles.caption, { color: colors.textSecondary }]}>{week.caption}</Text> : null}
      {week.status ? <Text style={[styles.caption, { color: colors.textSecondary }]}>{week.status}</Text> : null}
    </Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  strip: { gap: 8, paddingBottom: 2 },
  card: { minWidth: 128, maxWidth: 220, minHeight: 64, borderWidth: 1, borderRadius: 8, padding: 10, gap: 3 },
  title: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  caption: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
});
