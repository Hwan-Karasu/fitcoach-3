import { memo, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import type { Appointment, CalendarInterval, LocalDate } from "../domain/CalendarModel.ts";
import type { TimeWindow } from "../domain/CalendarGeometry.ts";
import type { CalendarParticipant } from "../domain/CalendarParticipantDirectoryPort.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { addDays, mondayOf, weekDates } from "../domain/CalendarRules.ts";
import { TimelineGrid, TimelineHours, type TimelineHandlers } from "./TimelineGrid.tsx";

/** Сколько недель (или дней) в каждую сторону можно пролистать от текущей даты. */
const WEEK_SPAN = 520;
const DAY_SPAN = 3650;

function daysBetween(from: LocalDate, to: LocalDate): number {
  const utc = (date: LocalDate) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Записи и интервалы одной страницы; перечитываются при изменениях календаря в её датах. */
function usePageRange(repository: CalendarRepositoryPort, from: LocalDate, to: LocalDate) {
  const [range, setRange] = useState<Readonly<{ appointments: readonly Appointment[]; intervals: readonly CalendarInterval[] }> | null>(null);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const request = ++generation.current;
    void repository.listRange(from, to).then((value) => {
      if (request === generation.current) setRange(value);
    }, () => undefined);
  }, [repository, from, to, tick]);
  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.dates === "ALL" || change.dates.some((date) => date >= from && date <= to)) setTick((value) => value + 1);
  }), [repository, from, to]);
  return range;
}

type PageShared = Readonly<{
  repository: CalendarRepositoryPort;
  visibleWeekdays: readonly boolean[];
  window: TimeWindow;
  people: ReadonlyMap<string, CalendarParticipant>;
  typeColors: ReadonlyMap<string, string>;
  now: Date;
  height: number;
  handlers: TimelineHandlers;
}>;

/** Одна страница ленты: неделя (видимые дни) или один день. Пока данные грузятся — пустая сетка с датами. */
const TimelinePage = memo(function TimelinePage({ start, week, width, shared }: Readonly<{
  start: LocalDate; week: boolean; width: number; shared: PageShared;
}>) {
  const dates = useMemo(() => week
    ? weekDates(start).filter((_, index) => shared.visibleWeekdays[index] ?? true) : [start], [shared.visibleWeekdays, start, week]);
  const range = usePageRange(shared.repository, start, week ? addDays(start, 6) : start);
  return (
    <View style={{ width }}>
      <TimelineGrid dates={dates} window={shared.window} appointments={range?.appointments ?? []}
        intervals={range?.intervals ?? []} people={shared.people} typeColors={shared.typeColors} now={shared.now}
        height={shared.height} handlers={shared.handlers} />
    </View>
  );
});

/**
 * Лента недель или дней: листается свайпом внутри неподвижной рамки, колонка часов слева стоит на
 * месте. Горизонтальный FlatList с постраничной прокруткой — соседние страницы отрисованы заранее.
 */
export function WeekPager({ mode, selected, today, scrollLocked, onSelect, ...shared }: PageShared & Readonly<{
  mode: "WEEK" | "DAY";
  selected: LocalDate;
  today: LocalDate;
  scrollLocked: boolean;
  onSelect: (date: LocalDate) => void;
}>) {
  const [width, setWidth] = useState(0);
  const [baseMonday] = useState(() => mondayOf(today));
  const [baseDay] = useState(today);
  const week = mode === "WEEK";
  const span = week ? WEEK_SPAN : DAY_SPAN;
  const target = week ? daysBetween(baseMonday, mondayOf(selected)) / 7 + span : daysBetween(baseDay, selected) + span;
  const list = useRef<FlatList<number>>(null);
  const shown = useRef(target);
  const shownMode = useRef(mode);
  const data = useMemo(() => Array.from({ length: span * 2 + 1 }, (_, at) => at), [span]);
  const startOf = (index: number) => week ? addDays(baseMonday, (index - span) * 7) : addDays(baseDay, index - span);

  // Смена режима строит новую ленту; дата сменилась не свайпом (месяц, «Сегодня») — прокрутка к ней.
  useEffect(() => {
    if (shownMode.current !== mode) { shownMode.current = mode; shown.current = target; return; }
    if (width === 0 || target === shown.current) return;
    shown.current = target;
    list.current?.scrollToIndex({ index: target, animated: true });
  }, [mode, target, width]);

  return (
    <View style={styles.row}>
      <TimelineHours window={shared.window} height={shared.height} />
      <View style={styles.pages} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
        {width > 0 ? (
          <FlatList key={mode} ref={list} data={data} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
            scrollEnabled={!scrollLocked} keyExtractor={(item) => String(item)} initialScrollIndex={target}
            windowSize={3} initialNumToRender={1} maxToRenderPerBatch={2}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            onMomentumScrollEnd={(event) => {
              const index = Math.round(event.nativeEvent.contentOffset.x / width);
              if (index === shown.current) return;
              const delta = index - shown.current;
              shown.current = index;
              onSelect(addDays(selected, delta * (week ? 7 : 1)));
            }}
            renderItem={({ item }) => <TimelinePage start={startOf(item)} week={week} width={width} shared={shared} />} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  pages: { flex: 1 },
});
