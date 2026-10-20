import { useMemo } from "react";
import DateTimePicker, { type DatePickerBaseProps } from "react-native-ui-datepicker";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { localDateOfPicker, localMidnight } from "./dateRange.ts";

export interface DateRange {
  /** Локальные даты `YYYY-MM-DD`; `null` — граница ещё не выбрана. */
  readonly from: string | null;
  readonly to: string | null;
}

/**
 * Календарь с выбором диапазона дат (react-native-ui-datepicker): один месяц со стрелками и выбором месяца и года, русские
 * названия, неделя с понедельника, будущее недоступно. Первое нажатие — начало, второе — конец. Цвета — из темы, шрифт —
 * через `fontFamily` (UI-OWN, «Зефирка»); сама библиотека без стилей по умолчанию.
 */
export function DateRangeCalendar({ value, max, onChange }: Readonly<{
  value: DateRange;
  /** Последняя доступная дата, включительно. */
  max: string;
  onChange: (range: DateRange) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const styles = useMemo((): DatePickerBaseProps["styles"] => ({
    day: { borderRadius: 12 },
    day_label: { color: colors.textPrimary, fontFamily: fonts.medium, fontSize: 14 },
    today: { borderWidth: 1.5, borderColor: colors.accentInk },
    today_label: { color: colors.accentInk, fontFamily: fonts.bold },
    outside_label: { color: colors.textMuted },
    disabled_label: { color: colors.textMuted, opacity: 0.4 },
    selected: { backgroundColor: colors.accentFill },
    selected_label: { color: colors.onAccentFill, fontFamily: fonts.bold },
    range_start: { backgroundColor: colors.accentFill },
    range_start_label: { color: colors.onAccentFill, fontFamily: fonts.bold },
    range_end: { backgroundColor: colors.accentFill },
    range_end_label: { color: colors.onAccentFill, fontFamily: fonts.bold },
    range_middle_label: { color: colors.accentInk, fontFamily: fonts.semibold },
    range_fill: { backgroundColor: colors.accentSoft },
    weekday_label: { color: colors.textMuted, fontFamily: fonts.semibold, fontSize: 11 },
    month_selector_label: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
    year_selector_label: { color: colors.textPrimary, fontFamily: fonts.bold, fontSize: 16 },
    month: { borderWidth: 0, borderRadius: 12, backgroundColor: colors.surfaceRaised },
    month_label: { color: colors.textPrimary, fontFamily: fonts.medium },
    selected_month: { backgroundColor: colors.accentFill },
    selected_month_label: { color: colors.onAccentFill, fontFamily: fonts.bold },
    year: { borderWidth: 0, borderRadius: 12, backgroundColor: colors.surfaceRaised },
    year_label: { color: colors.textPrimary, fontFamily: fonts.medium },
    selected_year: { backgroundColor: colors.accentFill },
    selected_year_label: { color: colors.onAccentFill, fontFamily: fonts.bold },
    active_year: { backgroundColor: colors.accentSoft },
    active_year_label: { color: colors.accentInk, fontFamily: fonts.bold },
  }), [colors]);
  return (
    <DateTimePicker mode="range" locale="ru" firstDayOfWeek={1} maxDate={localMidnight(max)} styles={styles}
      startDate={value.from === null ? undefined : localMidnight(value.from)}
      endDate={value.to === null ? undefined : localMidnight(value.to)}
      onChange={({ startDate, endDate }) => onChange({ from: localDateOfPicker(startDate), to: localDateOfPicker(endDate) })} />
  );
}
