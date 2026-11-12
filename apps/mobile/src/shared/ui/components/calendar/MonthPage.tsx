import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../theme/typography.ts";
import { daysInMonth, formatLong, isoOf, isWithin, leadingBlanks, type DateRange } from "./calendarRules.ts";

export const CALENDAR_ROW_HEIGHT = 48;
/** Шесть недель: страница одной высоты у любого месяца, чтобы лист не прыгал при свайпе. */
export const CALENDAR_BODY_HEIGHT = CALENDAR_ROW_HEIGHT * 6;

interface MonthPageProps {
  readonly year: number;
  readonly month: number;
  readonly min: string;
  readonly max: string;
  readonly today: string;
  readonly markers: ReadonlySet<string> | undefined;
  /** Одна дата или `null`; в режиме диапазона не используется. */
  readonly selected: string | null;
  /** В режиме одной даты `null`. */
  readonly range: DateRange | null;
  readonly onPick: (iso: string) => void;
}

/** Один месяц сеткой с понедельника: выбранный день, сегодня, недоступные, точки-отметки, заливка диапазона. */
export const MonthPage = memo(function MonthPage({ year, month, min, max, today, markers, selected, range, onPick }: MonthPageProps) {
  const colors = usePrototypeTheme().palette.tokens;
  const rows = useMemo(() => {
    const cells: (number | null)[] = [...Array.from({ length: leadingBlanks(year, month) }, () => null), ...Array.from({ length: daysInMonth(year, month) }, (_, index) => index + 1)];
    while (cells.length % 7 !== 0) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
  }, [year, month]);
  return (
    <View style={styles.page}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {row.map((day, cellIndex) => {
            if (day === null) return <View key={cellIndex} style={styles.cell} />;
            const iso = isoOf(year, month, day);
            const disabled = !isWithin(iso, min, max);
            const isStart = range !== null && range.from === iso;
            const isEnd = range !== null && range.to === iso;
            const marked = range === null ? selected === iso : isStart || isEnd;
            const inside = range !== null && range.from !== null && range.to !== null && iso > range.from && iso < range.to;
            const hasBand = range !== null && range.from !== null && range.to !== null && range.from !== range.to;
            const mark = markers?.has(iso) === true;
            return (
              <Pressable key={cellIndex} disabled={disabled} onPress={() => onPick(iso)} style={styles.cell} accessibilityRole="button"
                accessibilityLabel={`${formatLong(iso)}${mark ? ", есть записи" : ""}`} accessibilityState={{ selected: marked, disabled }}>
                {inside ? <View style={[styles.band, { backgroundColor: colors.accentSoft }]} /> : null}
                {hasBand && isStart ? <View style={[styles.band, styles.bandRight, { backgroundColor: colors.accentSoft }]} /> : null}
                {hasBand && isEnd ? <View style={[styles.band, styles.bandLeft, { backgroundColor: colors.accentSoft }]} /> : null}
                <View style={[styles.circle, marked ? { backgroundColor: colors.accentFill }
                  : iso === today ? { borderWidth: 1.5, borderColor: colors.accentInk } : null, disabled ? styles.disabled : null]}>
                  <Text style={[styles.label, { color: marked ? colors.onAccentFill : inside ? colors.onAccentSoft : iso === today ? colors.accentInk : colors.textPrimary },
                    marked || iso === today ? { fontFamily: fonts.bold } : null]}>{day}</Text>
                </View>
                {mark ? <View style={[styles.dot, { backgroundColor: marked ? colors.onAccentFill : colors.accentInk }, disabled ? styles.disabled : null]} /> : null}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  page: { alignSelf: "stretch" },
  row: { flexDirection: "row", height: CALENDAR_ROW_HEIGHT },
  cell: { flex: 1, height: CALENDAR_ROW_HEIGHT, alignItems: "center", justifyContent: "center" },
  circle: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  label: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 18 },
  disabled: { opacity: 0.32 },
  band: { position: "absolute", top: 3, bottom: 3, left: 0, right: 0 },
  bandRight: { left: "50%" },
  bandLeft: { right: "50%" },
  dot: { position: "absolute", bottom: 3, width: 5, height: 5, borderRadius: 3 },
});
