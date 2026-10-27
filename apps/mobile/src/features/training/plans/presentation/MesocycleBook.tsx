import { useCallback, useEffect, useRef, useState } from "react";
import { useIsFocused } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { useAnimatedRef } from "react-native-reanimated";
import Sortable from "react-native-sortables";
import { Plus, X } from "lucide-react-native";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { weeksWord } from "../domain/MesocycleBuilder.ts";
import type { Mesocycle } from "../domain/PeriodizedModel.ts";
import { useSortableFocusReset } from "./useSortableFocusReset.ts";
import { isCompleteMesocycleOrder } from "../domain/MesocycleOrder.ts";

/**
 * Книга мезоциклов клиента (UI-OWN-040, как в 2.0): квадратные карточки одной ширины, длинное название переносится
 * (до 3 строк, шрифт и интервал уменьшаются под название), все карточки — по высоте самой высокой; выбранная — в цвете недели. Долгое нажатие — перетащить
 * (порядок свой у этого клиента); «×» — удалить, если мезоциклов больше одного; пунктирная «+» — новый мезоцикл.
 */
export function MesocycleBook({ mesocycles, selectedId, resetKey, onSelect, onReorder, onAdd, onDelete }: Readonly<{
  mesocycles: readonly Mesocycle[];
  selectedId: string | undefined;
  /** Смена ключа возвращает порядок из данных (после неудачного сохранения перетаскивания). */
  resetKey: number;
  onSelect: (id: string) => void;
  onReorder: (ids: readonly string[]) => void;
  onAdd: () => void;
  onDelete?: (mesocycle: Mesocycle) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const bookRef = useAnimatedRef<Animated.ScrollView>();
  const focused = useIsFocused();
  const focusVersion = useSortableFocusReset(focused);
  // Sortable.Flex не растягивает элементы по высоте ряда — высоту самой высокой карточки замеряем сами.
  // Замер привязан к набору названий: сброс эффектом опаздывал бы — onLayout приходит раньше эффекта.
  // Порядок в подписи не участвует: перестановка не меняет высоту карточек, а сброс замера на кадр сжимал бы их (мерцание).
  const signature = mesocycles.map((item) => `${item.id}:${item.title}`).sort().join("|");
  const [measured, setMeasured] = useState({ signature, height: 0 });
  const height = measured.signature === signature ? measured.height : 0;
  const measure = (value: number) => setMeasured((current) => {
    const base = current.signature === signature ? current.height : 0;
    return value > base + 0.5 ? { signature, height: value } : current;
  });
  const deletable = onDelete !== undefined && mesocycles.length > 1;
  // Лента при входе прокручивается к выбранному мезоциклу (как лента недель): иначе при длинной книге он за краем экрана.
  // Карточки одной ширины с одним интервалом, поэтому смещение считается по номеру; прокрутка — один раз на выбранный мезоцикл
  // и только когда ширина содержимого уже известна (до раскладки прокрутка ничего не делает).
  const contentWidth = useRef(0);
  const alignedFor = useRef<string | undefined>(undefined);
  const align = useCallback(() => {
    const at = mesocycles.findIndex((item) => item.id === selectedId);
    if (selectedId === undefined || at < 0 || contentWidth.current === 0 || alignedFor.current === selectedId) return;
    alignedFor.current = selectedId;
    bookRef.current?.scrollTo({ x: at * (CARD_WIDTH + CARD_GAP), animated: false });
  }, [bookRef, mesocycles, selectedId]);
  useEffect(align, [align]);
  // Выбор нажатием не двигает ленту: карточка и так на виду.
  const choose = (id: string) => { alignedFor.current = id; onSelect(id); };


  return (
    <Animated.ScrollView ref={bookRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.book}
      onContentSizeChange={(width) => { contentWidth.current = width; align(); }}>
      <Sortable.Flex key={`${resetKey}:${focusVersion}`} gap={CARD_GAP} flexWrap="nowrap" activeItemScale={1.03} scrollableRef={bookRef}
        onDragEnd={({ order }) => {
          const current = mesocycles.map((item) => item.id);
          const next = order(current);
          if (isCompleteMesocycleOrder(current, next)) onReorder(next);
        }}>
        {mesocycles.map((item) => {
          const selected = item.id === selectedId;
          return (
            <Sortable.Touchable key={item.id} accessibilityHint="Долгое нажатие — перетащить"
              accessible accessibilityRole="button" accessibilityLabel={`Мезоцикл: ${item.title}, ${weeksWord(item.weeks.length)}`}
              accessibilityState={{ selected }} onAccessibilityTap={() => choose(item.id)} onTap={() => choose(item.id)}>
              <View onLayout={(event) => measure(event.nativeEvent.layout.height)}
                style={[styles.card, selected ? null : shadow.card, { minHeight: Math.max(height, MIN_HEIGHT), backgroundColor: selected ? colors.accentSoft : colors.surface,
                  borderColor: selected ? colors.accentInk : "transparent" }]}>
                <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={styles.body}>
                  <Text numberOfLines={3} adjustsFontSizeToFit minimumFontScale={0.6} style={[styles.title, deletable ? styles.titleWithClose : null,
                    { color: selected ? colors.accentInk : colors.textPrimary }]}>{item.title}</Text>
                  <Text style={[styles.meta, { color: selected ? colors.accentInk : colors.textSecondary }]}>{weeksWord(item.weeks.length)}</Text>
                </View>
                {deletable ? <Pressable accessibilityRole="button" accessibilityLabel={`Удалить мезоцикл ${item.title}`}
                  hitSlop={12} onPress={() => onDelete?.(item)} style={styles.close}>
                  <X size={16} color={colors.textSecondary} strokeWidth={2} />
                </Pressable> : null}
              </View>
            </Sortable.Touchable>
          );
        })}
      </Sortable.Flex>
      <Pressable accessibilityRole="button" accessibilityLabel="Добавить мезоцикл" onPress={onAdd}
        style={({ pressed }) => [styles.card, styles.add, { minHeight: Math.max(height, MIN_HEIGHT), borderColor: colors.accentInk,
          backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
        <Plus size={22} color={colors.accentInk} strokeWidth={2} />
        <Text style={[styles.meta, { color: colors.accentInk }]}>Мезоцикл</Text>
      </Pressable>
    </Animated.ScrollView>
  );
}

const MIN_HEIGHT = 88;
const CARD_WIDTH = 150;
const CARD_GAP = 8;

const styles = StyleSheet.create({
  book: { flexDirection: "row", alignItems: "flex-start", gap: CARD_GAP, paddingTop: 4, paddingBottom: 4 },
  // Рамка одной толщины: смена толщины меняла бы высоту и замер самой высокой.
  card: { width: CARD_WIDTH, borderRadius: 18, borderWidth: 2, padding: 12 },
  body: { gap: 4 },
  // Без lineHeight: интервал уменьшается вместе со шрифтом (adjustsFontSizeToFit).
  title: { fontFamily: fonts.bold, fontSize: 15 },
  titleWithClose: { paddingRight: 16 },
  meta: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  close: { position: "absolute", top: 6, right: 6, width: 20, height: 20, alignItems: "center", justifyContent: "center" },
  add: { borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 2 },
});
