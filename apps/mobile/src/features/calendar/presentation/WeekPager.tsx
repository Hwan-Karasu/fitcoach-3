import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type PageRange = Readonly<{ appointments: readonly Appointment[]; intervals: readonly CalendarInterval[] }>;

/** Данные недели, уже прочитанные экраном: первая страница показывает их без повторного запроса. */
export type PageSeed = Readonly<{ monday: LocalDate } & PageRange>;

/** Записи и интервалы одной страницы; перечитываются при изменениях календаря в её датах. */
function usePageRange(repository: CalendarRepositoryPort, from: LocalDate, to: LocalDate, seed: PageSeed | undefined) {
  const [range, setRange] = useState<PageRange | null>(() => seed !== undefined && seed.monday === from && addDays(from, 6) === to ? seed : null);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const seeded = useRef(range !== null);
  useEffect(() => {
    if (seeded.current) { seeded.current = false; return; }
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
  /** Всегда актуальные данные экрана для недели, с которой открыт календарь (читается один раз при создании страницы). */
  seedRef: { readonly current: PageSeed | undefined };
}>;

/** Одна страница ленты: неделя (видимые дни) или один день. Пока данные грузятся — пустая сетка с датами. */
const TimelinePage = memo(function TimelinePage({ start, week, width, shared }: Readonly<{
  start: LocalDate; week: boolean; width: number; shared: PageShared;
}>) {
  const dates = useMemo(() => week
    ? weekDates(start).filter((_, index) => shared.visibleWeekdays[index] ?? true) : [start], [shared.visibleWeekdays, start, week]);
  const range = usePageRange(shared.repository, start, week ? addDays(start, 6) : start, shared.seedRef.current);
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
export function WeekPager({ mode, selected, today, scrollLocked, onSelect, repository, visibleWeekdays, window, people,
  typeColors, now, handlers, maxHeight, seed, initialWidth = 0 }: Omit<PageShared, "height" | "seedRef"> & Readonly<{
  seed?: PageSeed;
  /** Ширина ленты, вычисленная из размера окна: страницы строятся сразу, измерение лишь уточняет. */
  initialWidth?: number;
  /** Высота, в которую должен поместиться весь день от начала до конца. */
  maxHeight: number;
  mode: "WEEK" | "DAY";
  selected: LocalDate;
  today: LocalDate;
  scrollLocked: boolean;
  onSelect: (date: LocalDate) => void;
}>) {
  const [width, setWidth] = useState(initialWidth);
  // Высота часа — меньшее из «≈85% ширины столбца недели» (пропорции рабочей версии 2.0) и «весь день
  // помещается на экране»; в режиме «День» тот же шаг часов, чтобы сетка не прыгала при переключении.
  const visibleCount = Math.max(1, visibleWeekdays.filter(Boolean).length);
  const hours = Math.max(1, (window.endMinute - window.startMinute) / 60);
  // Пока ширина не измерена, ограничивает только высота экрана: колонка часов сразу нужного размера, без прыжка.
  const widthBound = width > 0 ? Math.round((width / visibleCount) * 0.85) : Number.POSITIVE_INFINITY;
  const hourHeight = Math.max(18, Math.min(widthBound, Math.floor(maxHeight / hours)));
  const height = Math.round(hourHeight * hours);
  // Общие параметры страниц — один объект, пока они не меняются: открытие меню не перерисовывает сетку.
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const shared = useMemo<PageShared>(() => ({ repository, visibleWeekdays, window, people, typeColors, now, height, handlers, seedRef }),
    [repository, visibleWeekdays, window, people, typeColors, now, height, handlers]);
  const [baseMonday] = useState(() => mondayOf(today));
  const [baseDay] = useState(today);
  const week = mode === "WEEK";
  const span = week ? WEEK_SPAN : DAY_SPAN;
  const target = week ? daysBetween(baseMonday, mondayOf(selected)) / 7 + span : daysBetween(baseDay, selected) + span;
  const list = useRef<FlatList<number>>(null);
  const shown = useRef(target);
  const shownMode = useRef(mode);
  const data = useMemo(() => Array.from({ length: span * 2 + 1 }, (_, at) => at), [span]);
  const renderPage = useCallback(({ item }: Readonly<{ item: number }>) => (
    <TimelinePage start={week ? addDays(baseMonday, (item - span) * 7) : addDays(baseDay, item - span)} week={week}
      width={width} shared={shared} />
  ), [baseDay, baseMonday, shared, span, week, width]);

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
      <View style={styles.pages} onLayout={(event) => { const next = event.nativeEvent.layout.width; setWidth((current) => Math.abs(current - next) < 0.5 ? current : next); }}>
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
            renderItem={renderPage} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row" },
  pages: { flex: 1 },
});
