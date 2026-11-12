import { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Pencil } from "lucide-react-native";
import { usePrototypeTheme } from "../../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../theme/typography.ts";
import { CalendarPager } from "../CalendarPager.tsx";
import type { CalendarView } from "./calendarProfiles.ts";
import {
  addMonths, applyRangeTap, clampToBounds, firstOfMonth, formatLong, formatNumeric, isWithin, maskTyped, monthIndex, monthOfPage, monthPageCount,
  monthPageOf, MONTH_NAMES, parseTyped, partsOf, WEEKDAY_HEADERS, yearList, type DateRange,
} from "./calendarRules.ts";
import { CALENDAR_BODY_HEIGHT, MonthPage } from "./MonthPage.tsx";

interface CommonProps {
  readonly min: string;
  readonly max: string;
  readonly today: string;
  readonly startView?: CalendarView;
  /** Месяц, с которого календарь открывается (по умолчанию — месяц выбранной даты, иначе сегодняшний в границах). */
  readonly startAt?: string;
  readonly markers?: ReadonlySet<string>;
  readonly showToday?: boolean;
  /** Карандаш: дату можно набрать цифрами `ДД.ММ.ГГГГ` (только дата рождения). */
  readonly typing?: boolean;
}
type SingleProps = CommonProps & { readonly mode: "single"; readonly value: string | null; readonly onChange: (iso: string) => void };
type RangeProps = CommonProps & { readonly mode: "range"; readonly value: DateRange; readonly onChange: (range: DateRange) => void };
export type AppCalendarProps = SingleProps | RangeProps;

const YEAR_ROW = 54;

/**
 * Единый календарь приложения (UI-OWN-094). Месяцы листаются свайпом и стрелками (`CalendarPager`), название месяца и года — кнопки:
 * месяц открывает сетку месяцев, год — прокручиваемый список лет. Режимы: одна дата и диапазон; необязательно — «Сегодня», точки на днях,
 * ввод цифрами. Что включено, решает профиль (`calendarProfiles.ts`); сам компонент ничего не знает о конкретных экранах. Цвета — из темы.
 */
export function AppCalendar(props: AppCalendarProps) {
  const { min, max, today, markers, showToday = false, typing = false } = props;
  const colors = usePrototypeTheme().palette.tokens;
  const single = props.mode === "single" ? props : null;
  const ranged = props.mode === "range" ? props : null;
  const [view, setView] = useState<CalendarView>(props.startView ?? "day");
  // Открывается один раз на месяце значения; дальше месяц ведёт сам календарь.
  const [cursor, setCursor] = useState(() => firstOfMonth(clampToBounds(props.startAt ?? (single?.value ?? ranged?.value.from ?? today), min, max)));
  const [typed, setTyped] = useState<string | null>(null);
  const cursorParts = partsOf(cursor);
  const pageCount = monthPageCount(min, max);
  const lastMonth = monthIndex(max), firstMonth = monthIndex(min);
  const cursorMonth = monthIndex(cursor);
  const selectedValue = single?.value ?? null;
  const rangeValue = ranged?.value ?? null;
  const emitRef = useRef<(value: string | DateRange) => void>(() => undefined);
  emitRef.current = props.onChange as (value: string | DateRange) => void;

  const pick = useCallback((iso: string) => {
    emitRef.current(rangeValue !== null ? applyRangeTap(rangeValue, iso) : iso);
  }, [rangeValue]);
  const renderPage = useCallback((page: number, width: number) => {
    const { year, month } = partsOf(monthOfPage(page, min));
    // Пейджер кладёт страницы в горизонтальный список: ширина страницы задаётся здесь.
    return <View style={{ width }}><MonthPage year={year} month={month} min={min} max={max} today={today} markers={markers} selected={selectedValue} range={rangeValue} onPick={pick} /></View>;
  }, [min, max, today, markers, selectedValue, rangeValue, pick]);

  const typedResult = typed === null ? null : parseTyped(typed, min, max);
  const onType = (raw: string) => {
    const masked = maskTyped(raw);
    setTyped(masked);
    const result = parseTyped(masked, min, max);
    if (result.kind === "ok") { emitRef.current(result.value); setCursor(firstOfMonth(result.value)); }
  };

  const chevron = (direction: "prev" | "next", label: string, disabled: boolean, onPress: () => void) => {
    const Icon = direction === "prev" ? ChevronLeft : ChevronRight;
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={styles.arrow}>
        <Icon size={22} color={colors.iconPrimary} style={disabled ? styles.faded : undefined} />
      </Pressable>
    );
  };
  const chip = (label: string, accessibility: string, onPress: () => void, active = false) => (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibility} onPress={onPress}
      style={[styles.chip, { borderColor: active ? colors.accentInk : colors.border, backgroundColor: active ? colors.accentSoft : colors.surface }]}>
      <Text style={[styles.chipText, { color: active ? colors.onAccentSoft : colors.textPrimary }]}>{label}</Text>
      <ChevronDown size={16} color={colors.accentInk} />
    </Pressable>
  );

  const summary = ranged === null ? (
    <View style={[styles.summary, { borderColor: colors.border }]}>
      <View style={styles.summaryText}>
        <Text style={[styles.small, { color: colors.textMuted }]}>Выбранная дата</Text>
        <Text style={[selectedValue === null ? styles.summaryNone : styles.summaryValue, { color: selectedValue === null ? colors.textMuted : colors.textPrimary }]}>
          {selectedValue === null ? "Не выбрана" : formatLong(selectedValue)}
        </Text>
      </View>
      {typing ? (
        <Pressable accessibilityRole="button" accessibilityLabel={typed === null ? "Ввести дату цифрами" : "Выбрать дату в календаре"} style={styles.arrow}
          onPress={() => setTyped(typed === null ? (selectedValue === null ? "" : formatNumeric(selectedValue)) : null)}>
          {typed === null ? <Pencil size={21} color={colors.iconPrimary} /> : <CalendarDays size={21} color={colors.iconPrimary} />}
        </Pressable>
      ) : null}
    </View>
  ) : (
    <View style={[styles.summary, styles.rangeSummary, { borderColor: colors.border }]}>
      {([["Начало", ranged.value.from], ["Конец", ranged.value.to]] as const).map(([label, value]) => (
        <View key={label} style={[styles.rangeBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.small, { color: colors.textMuted }]}>{label}</Text>
          <Text style={[styles.rangeValue, { color: value === null ? colors.textMuted : colors.textPrimary }]}>{value === null ? "—" : formatNumeric(value)}</Text>
        </View>
      ))}
    </View>
  );

  let body;
  if (typed !== null) {
    body = (
      <View style={{ height: CALENDAR_BODY_HEIGHT }}>
        <TextInput value={typed} onChangeText={onType} keyboardType="number-pad" maxLength={10} autoFocus placeholder="ДД.ММ.ГГГГ"
          placeholderTextColor={colors.textMuted} accessibilityLabel="Дата цифрами, день, месяц, год"
          style={[styles.typing, { color: colors.textPrimary, backgroundColor: colors.input, borderColor: typedResult?.kind === "error" ? colors.danger : colors.accentInk }]} />
        <Text accessibilityLiveRegion="polite" style={[styles.typingNote, { color: typedResult?.kind === "error" ? colors.danger : colors.textSecondary }]}>
          {typedResult?.kind === "error" ? typedResult.message : typedResult?.kind === "ok" ? `Выбрано: ${formatLong(typedResult.value)}` : `Например, 05.03.1991. Допустимо с ${formatNumeric(min)} по ${formatNumeric(max)}.`}
        </Text>
      </View>
    );
  } else if (view === "month") {
    body = (
      <View style={[styles.monthGrid, { height: CALENDAR_BODY_HEIGHT }]}>
        {MONTH_NAMES.map((name, index) => {
          const month = index + 1;
          const iso = `${cursorParts.year}-${String(month).padStart(2, "0")}-01`;
          const disabled = monthIndex(iso) < firstMonth || monthIndex(iso) > lastMonth;
          const current = month === cursorParts.month;
          return (
            <Pressable key={name} disabled={disabled} accessibilityRole="button" accessibilityLabel={`${name} ${cursorParts.year}`} accessibilityState={{ selected: current, disabled }}
              onPress={() => { setCursor(iso); setView("day"); }}
              style={[styles.monthCell, { backgroundColor: current ? colors.accentFill : colors.surface }, disabled ? styles.faded : null]}>
              <Text style={[styles.cellText, { color: current ? colors.onAccentFill : colors.textPrimary }, current ? { fontFamily: fonts.bold } : null]}>{name}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  } else if (view === "year") {
    body = <YearList min={min} max={max} cursorYear={cursorParts.year} selectedYear={selectedValue === null ? null : partsOf(selectedValue).year}
      onPick={(year) => { setCursor(firstOfMonth(clampToBounds(`${year}-${String(cursorParts.month).padStart(2, "0")}-01`, min, max))); setView("month"); }} />;
  } else {
    body = (
      <View>
        <View style={styles.weekdays}>
          {WEEKDAY_HEADERS.map((name) => <Text key={name} style={[styles.weekday, { color: colors.textMuted }]}>{name}</Text>)}
        </View>
        <CalendarPager page={monthPageOf(cursor, min)} pageCount={pageCount} height={CALENDAR_BODY_HEIGHT}
          onPageChange={(page) => setCursor(monthOfPage(page, min))} renderPage={renderPage} />
      </View>
    );
  }

  const header = typed !== null ? null : view === "day" ? (
    <View style={styles.header}>
      {chip(MONTH_NAMES[cursorParts.month - 1] ?? "", `Выбрать месяц, сейчас ${MONTH_NAMES[cursorParts.month - 1]}`, () => setView("month"))}
      {chip(String(cursorParts.year), `Выбрать год, сейчас ${cursorParts.year}`, () => setView("year"))}
      <View style={styles.spacer} />
      {chevron("prev", "Предыдущий месяц", cursorMonth <= firstMonth, () => setCursor(addMonths(cursor, -1)))}
      {chevron("next", "Следующий месяц", cursorMonth >= lastMonth, () => setCursor(addMonths(cursor, 1)))}
    </View>
  ) : view === "month" ? (
    <View style={styles.header}>
      {chip(String(cursorParts.year), `Выбрать год, сейчас ${cursorParts.year}`, () => setView("year"), true)}
      <View style={styles.spacer} />
      {chevron("prev", "Предыдущий год", cursorParts.year <= partsOf(min).year, () => setCursor(firstOfMonth(clampToBounds(addMonths(cursor, -12), min, max))))}
      {chevron("next", "Следующий год", cursorParts.year >= partsOf(max).year, () => setCursor(firstOfMonth(clampToBounds(addMonths(cursor, 12), min, max))))}
    </View>
  ) : (
    <View style={styles.header}>
      <Text style={[styles.yearTitle, { color: colors.textPrimary }]}>Выберите год</Text>
      <View style={styles.spacer} />
      <Pressable accessibilityRole="button" accessibilityLabel="Вернуться к дням" onPress={() => setView("day")} style={[styles.chip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.chipText, { color: colors.textPrimary }]}>К дням</Text>
      </Pressable>
    </View>
  );

  const todayEnabled = showToday && single !== null && typed === null && view !== "year";
  return (
    <View>
      {summary}
      {header}
      {body}
      {todayEnabled ? (
        <View style={styles.quick}>
          <Pressable accessibilityRole="button" accessibilityLabel="Выбрать сегодняшнюю дату" disabled={!isWithin(today, min, max)}
            onPress={() => { emitRef.current(today); setCursor(firstOfMonth(today)); setView("day"); }}
            style={[styles.quickChip, { borderColor: colors.border, backgroundColor: colors.surface }, isWithin(today, min, max) ? null : styles.faded]}>
            <Text style={[styles.quickText, { color: colors.textPrimary }]}>Сегодня</Text>
          </Pressable>
          {markers !== undefined ? (
            <View style={styles.legend}>
              <View style={[styles.legendDot, { backgroundColor: colors.accentInk }]} />
              <Text style={[styles.small, { color: colors.textMuted }]}>есть записи</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function YearList({ min, max, cursorYear, selectedYear, onPick }: Readonly<{ min: string; max: string; cursorYear: number; selectedYear: number | null; onPick: (year: number) => void }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const years = useMemo(() => yearList(min, max), [min, max]);
  const ref = useRef<ScrollView>(null);
  const centre = (height: number) => {
    const row = Math.floor(Math.max(0, years.indexOf(cursorYear)) / 3);
    ref.current?.scrollTo({ y: Math.max(0, row * YEAR_ROW - height / 2 + YEAR_ROW / 2), animated: false });
  };
  return (
    <ScrollView ref={ref} style={{ height: CALENDAR_BODY_HEIGHT }} contentContainerStyle={styles.yearGrid} onLayout={(event) => centre(event.nativeEvent.layout.height)}
      accessibilityLabel="Список лет">
      {years.map((year) => {
        const selected = year === selectedYear, current = year === cursorYear;
        return (
          <Pressable key={year} accessibilityRole="button" accessibilityLabel={String(year)} accessibilityState={{ selected: selected || current }} onPress={() => onPick(year)}
            style={[styles.yearCell, { backgroundColor: selected ? colors.accentFill : current ? colors.accentSoft : colors.surface }]}>
            <Text style={[styles.cellText, { color: selected ? colors.onAccentFill : current ? colors.onAccentSoft : colors.textPrimary }, selected || current ? { fontFamily: fonts.bold } : null]}>{year}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: "row", alignItems: "center", minHeight: 60, borderBottomWidth: 1, paddingBottom: 6, marginBottom: 2, gap: 8 },
  summaryText: { flex: 1, minWidth: 0 },
  summaryValue: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  summaryNone: { fontFamily: fonts.regular, fontSize: 20, lineHeight: 26 },
  small: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  rangeSummary: { gap: 8, paddingTop: 2 },
  rangeBox: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 6, minHeight: 52 },
  rangeValue: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  header: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 56 },
  spacer: { flex: 1 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderRadius: 12 },
  chipText: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  arrow: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  faded: { opacity: 0.32 },
  yearTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20, paddingLeft: 4 },
  weekdays: { flexDirection: "row", height: 24, alignItems: "center" },
  weekday: { flex: 1, textAlign: "center", fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14 },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignContent: "flex-start" },
  monthCell: { width: "31.5%", height: 66, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cellText: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  yearGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 },
  yearCell: { width: "31.5%", height: 46, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  typing: { minHeight: 56, borderWidth: 2, borderRadius: 12, paddingHorizontal: 14, fontFamily: fonts.bold, fontSize: 22, letterSpacing: 1 },
  typingNote: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, marginTop: 8, paddingHorizontal: 2 },
  quick: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingTop: 6 },
  quickChip: { minHeight: 44, paddingHorizontal: 14, borderWidth: 1, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  quickText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  legend: { flexDirection: "row", alignItems: "center", gap: 6, marginLeft: "auto" },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
});
