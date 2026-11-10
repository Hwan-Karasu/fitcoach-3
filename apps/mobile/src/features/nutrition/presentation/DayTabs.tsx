import { Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarDays } from "lucide-react-native";
import { pickDate } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { dateOfTab, dayTabOf, type DayTab } from "../domain/DayNavigation.ts";
import { useClientDay } from "./ClientDay.tsx";
import { dayTitle } from "./nutritionFormat.ts";

const tabs: readonly Readonly<{ id: DayTab; label: string }>[] = [
  { id: "YESTERDAY", label: "Вчера" }, { id: "TODAY", label: "Сегодня" }, { id: "TOMORROW", label: "Завтра" },
];

/**
 * «Вчера | Сегодня | Завтра» и календарь (UIX-05, UI-OWN-070; вид — макет): вкладки с подчёркиванием выбранной, справа кнопка-календарь.
 * Календарь — системный выбор даты (UI-OWN-023); выбранная в нём дата показывается в самой кнопке («Пт, 7 нояб.»), на «Сегодня» возвращает вкладка.
 */
export function DayTabs() {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { day, today, setDay } = useClientDay();
  const current = dayTabOf(day, today);
  const custom = current === null;
  return (
    <View style={[styles.row, { borderBottomColor: colors.border }]} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const selected = current === tab.id;
        return (
          <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected }}
            accessibilityLabel={`${tab.label}, ${dayTitle(dateOfTab(tab.id, today), today)}`}
            onPress={() => setDay(dateOfTab(tab.id, today))} hitSlop={{ top: 4, bottom: 4 }} style={styles.tab}>
            <Text style={[styles.label, { color: selected ? colors.textPrimary : colors.textMuted, fontFamily: selected ? fonts.bold : fonts.semibold }]}>{tab.label}</Text>
            {selected ? <View style={[styles.underline, styles.tabUnderline, { backgroundColor: colors.accentFill }]} /> : null}
          </Pressable>
        );
      })}
      <Pressable accessibilityRole="button" accessibilityState={{ selected: custom }}
        accessibilityLabel={custom ? `${dayTitle(day, today)}. Выбрать другую дату в календаре` : "Выбрать дату в календаре"}
        onPress={() => { void pickDate({ value: day }).then((picked) => { if (picked !== null) setDay(picked); }); }} hitSlop={{ top: 4, bottom: 4 }} style={styles.calendar}>
        {custom ? <Text numberOfLines={1} style={[styles.dateText, { color: colors.textPrimary }]}>{shortDate(day)}</Text> : null}
        <CalendarDays size={20} color={custom ? colors.accentInk : colors.textSecondary} strokeWidth={2} />
        {custom ? <View style={[styles.underline, styles.calendarUnderline, { backgroundColor: colors.accentFill }]} /> : null}
      </Pressable>
    </View>
  );
}

const weekdays = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"] as const;
const months = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."] as const;
/** «Пт, 7 нояб.» — день недели считается по UTC-полуночи той же даты, часовой пояс не влияет. */
function shortDate(date: string): string {
  const weekday = weekdays[new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? "";
  return `${weekday}, ${Number(date.slice(8, 10))} ${months[Number(date.slice(5, 7)) - 1] ?? ""}`;
}

const styles = StyleSheet.create({
  /** Высота 40 по макету, зона нажатия расширена `hitSlop` до 48; линия — на всю ширину контейнера. */
  row: { flexDirection: "row", alignItems: "stretch", borderBottomWidth: 1 },
  tab: { flex: 1, minWidth: 0, minHeight: 40, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  label: { fontSize: 14, lineHeight: 19 },
  calendar: { minHeight: 40, minWidth: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  dateText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17, flexShrink: 1 },
  underline: { position: "absolute", bottom: -1, height: 3, borderRadius: 2 },
  tabUnderline: { left: "18%", right: "18%" },
  calendarUnderline: { left: 14, right: 14 },
});
