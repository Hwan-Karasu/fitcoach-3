import { memo, useCallback } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { CalendarDays } from "lucide-react-native";
import { pickDate } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { CAROUSEL_RADIUS, carouselSlots } from "../domain/DayNavigation.ts";
import { useClientDay } from "./ClientDay.tsx";
import { dayTitle } from "./nutritionFormat.ts";

/** Сколько колонок видно одновременно: слева и справа от выбранного дня по одному. */
const VISIBLE_COLUMNS = 3;
const SLOT_COUNT = CAROUSEL_RADIUS * 2 + 1;
/** Ширина кнопки-календаря справа: 14 + 20 + 14. */
const CALENDAR_WIDTH = 48;

/** Один день ленты. Перерисовывается только при смене подписи, даты или выбранности — не на каждый кадр слайда. */
const DaySlot = memo(function DaySlot({ date, label, title, selected, edge, onSelect }: Readonly<{
  date: string; label: string; title: string; selected: boolean; edge: boolean; onSelect: (date: string) => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={`${label}, ${title}`}
      importantForAccessibility={edge ? "no-hide-descendants" : "auto"} accessibilityElementsHidden={edge}
      onPress={() => onSelect(date)} hitSlop={{ top: 4, bottom: 4 }} style={styles.slot}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
        style={[styles.label, { color: selected ? colors.textPrimary : colors.textMuted, fontFamily: selected ? fonts.bold : fonts.semibold }]}>{label}</Text>
    </Pressable>
  );
});

/** Движущаяся лента из пяти дней: ширина колонки — треть видимой области, смещение берётся с UI-потока. */
function Strip({ selected, today, shift, onSelect }: Readonly<{
  selected: string; today: string; shift: SharedValue<number>; onSelect: (date: string) => void;
}>) {
  // До первого измерения ширина оценивается по окну (минус кнопка календаря): лента не мигает пустой.
  const { width: windowWidth } = useWindowDimensions();
  const column = useSharedValue(Math.max(0, windowWidth - CALENDAR_WIDTH) / VISIBLE_COLUMNS);
  const measure = useCallback((event: LayoutChangeEvent) => { column.value = event.nativeEvent.layout.width / VISIBLE_COLUMNS; }, [column]);
  const moving = useAnimatedStyle(() => ({
    width: column.value * SLOT_COUNT,
    // Крайние слоты за пределами видимости: выбранный день — вторая колонка видимой области.
    transform: [{ translateX: (shift.value - CAROUSEL_RADIUS + 1) * column.value }],
  }));
  const slots = carouselSlots(selected, today);
  return (
    <View style={styles.window} onLayout={measure}>
      <Animated.View style={[styles.strip, moving]}>
        {slots.map((slot, index) => <DaySlot key={slot.date} date={slot.date} label={slot.label} title={dayTitle(slot.date, today)}
          selected={index === CAROUSEL_RADIUS} edge={index === 0 || index === SLOT_COUNT - 1} onSelect={onSelect} />)}
      </Animated.View>
    </View>
  );
}

/**
 * Дни — карусель (UIX-05, UI-OWN-070, UIX-FIT-11): «Вчера · Сегодня · Завтра», а дальше в обе стороны просто даты («11.10.2026»). Выбранный день — по центру
 * под линией; ленту ведёт палец (свайп по содержимому, `DaySwipe`) или нажатие на соседний день, смена — плавный слайд на UI-потоке без перерисовки экрана.
 * Справа кнопка-календарь (системный выбор даты, UI-OWN-023): дальнюю дату выбирают в нём, лента встаёт на неё без слайда.
 */
export function DayTabs() {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { day, today, setDay, stripShift } = useClientDay();
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]} accessibilityRole="tablist">
      <View style={styles.carousel}>
        <Strip selected={day} today={today} shift={stripShift} onSelect={setDay} />
        <View pointerEvents="none" style={[styles.underline, { backgroundColor: colors.accentFill }]} />
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Выбрать дату в календаре. Сейчас ${dayTitle(day, today)}`}
        onPress={() => { void pickDate({ value: day }).then((picked) => { if (picked !== null) setDay(picked); }); }} hitSlop={{ top: 4, bottom: 4 }} style={styles.calendar}>
        <CalendarDays size={20} color={colors.textSecondary} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  /** Высота 40 по макету, зона нажатия расширена `hitSlop` до 48; линия — на всю ширину контейнера. */
  row: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1 },
  carousel: { flex: 1, minWidth: 0, minHeight: 40 },
  window: { flex: 1, overflow: "hidden" },
  strip: { flex: 1, flexDirection: "row" },
  slot: { width: `${100 / SLOT_COUNT}%`, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  label: { fontSize: 14, lineHeight: 19 },
  calendar: { minHeight: 40, width: CALENDAR_WIDTH, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  /** Линия под выбранным днём — по центру видимой области, на месте, пока лента едет. */
  underline: { position: "absolute", bottom: -1, left: "39.3%", right: "39.3%", height: 3, borderRadius: 2 },
});
