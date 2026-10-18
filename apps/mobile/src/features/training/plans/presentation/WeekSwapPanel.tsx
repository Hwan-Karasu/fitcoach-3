import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type Animated from "react-native-reanimated";
import type { AnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import { GripVertical } from "lucide-react-native";
import { AppButton } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";

type WeekRow = Readonly<{ id: string; index: number; caption: string; workouts: number }>;

/**
 * «Поменять недели местами» (§48.21 п. 5): перетаскивание в режиме обмена — две недели меняются местами
 * целиком, остальные остаются на своих местах. Каждый обмен сохраняется сразу; номер недели — её позиция.
 */
export function WeekSwapPanel({ weeks, scrollRef, onSwap, onDone }: Readonly<{
  weeks: readonly WeekRow[];
  scrollRef: AnimatedRef<Animated.ScrollView>;
  /** Возвращает false, если обмен не сохранился — тогда список возвращается к сохранённому порядку. */
  onSwap: (first: number, second: number) => Promise<boolean>;
  onDone: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [reset, setReset] = useState(0);
  const [busy, setBusy] = useState(false);
  return (
    <View style={styles.panel}>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Перетащите неделю за ручку на место другой — они поменяются местами вместе с тренировками и результатами.
      </Text>
      <Sortable.Grid key={reset} data={[...weeks]} keyExtractor={(week) => week.id} columns={1} rowGap={8} customHandle
        strategy="swap" scrollableRef={scrollRef} activeItemScale={1.03} sortEnabled={!busy}
        renderItem={({ item }: Readonly<{ item: WeekRow }>) => (
          <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Sortable.Handle>
              <View accessible accessibilityLabel={`Перетащить неделю ${item.index}`} style={styles.handle}>
                <GripVertical size={20} color={colors.textMuted} strokeWidth={1.8} />
              </View>
            </Sortable.Handle>
            <View style={styles.grow}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{`Неделя ${item.index}`}</Text>
              <Text style={[styles.hint, { color: colors.textSecondary }]}>{`${item.caption} · тренировок: ${item.workouts}`}</Text>
            </View>
          </View>
        )}
        onDragEnd={({ fromIndex, toIndex }) => {
          if (fromIndex === toIndex) return;
          setBusy(true);
          void onSwap(fromIndex + 1, toIndex + 1).then((saved) => { if (!saved) setReset((value) => value + 1); })
            .finally(() => setBusy(false));
        }} />
      <AppButton label="Готово" disabled={busy} onPress={onDone} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingRight: 12, minHeight: 64 },
  handle: { width: 44, minHeight: 56, alignItems: "center", justifyContent: "center" },
  grow: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  hint: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
