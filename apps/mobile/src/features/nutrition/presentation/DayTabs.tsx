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
 * «Вчера | Сегодня | Завтра» и календарь (UIX-05, UI-OWN-070): выбор общего дня клиента. Календарь — системный выбор даты (UI-OWN-023);
 * выбранная в нём дата показывается в ряду четвёртой пилюлей, нажатие на неё возвращает на «Сегодня».
 */
export function DayTabs() {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { day, today, setDay } = useClientDay();
  const current = dayTabOf(day, today);
  const pill = (selected: boolean) => [styles.pill, { backgroundColor: selected ? colors.accentFill : colors.surface, borderColor: selected ? "transparent" : colors.border }];
  const ink = (selected: boolean) => ({ color: selected ? colors.onAccentFill : colors.textSecondary });
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {tabs.map((tab) => (
        <Pressable key={tab.id} accessibilityRole="tab" accessibilityState={{ selected: current === tab.id }}
          accessibilityLabel={`${tab.label}, ${dayTitle(dateOfTab(tab.id, today), today)}`}
          onPress={() => setDay(dateOfTab(tab.id, today))} style={pill(current === tab.id)}>
          <Text style={[styles.label, ink(current === tab.id)]}>{tab.label}</Text>
        </Pressable>
      ))}
      {current === null ? (
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: true }} accessibilityLabel={`${dayTitle(day, today)}. Вернуться на сегодня`}
          onPress={() => setDay(today)} style={pill(true)}>
          <Text numberOfLines={1} style={[styles.label, ink(true)]}>{shortDate(day)}</Text>
        </Pressable>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Выбрать дату в календаре"
        onPress={() => { void pickDate({ value: day }).then((picked) => { if (picked !== null) setDay(picked); }); }}
        style={[styles.calendar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <CalendarDays size={20} color={colors.accentInk} strokeWidth={2} />
      </Pressable>
    </View>
  );
}

const months = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."] as const;
function shortDate(date: string): string {
  return `${Number(date.slice(8, 10))} ${months[Number(date.slice(5, 7)) - 1] ?? ""}`;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  pill: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  calendar: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
