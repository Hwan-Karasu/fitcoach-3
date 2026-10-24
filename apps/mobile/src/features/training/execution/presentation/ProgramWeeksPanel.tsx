import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { navigationPerformance } from "../../../../shared/diagnostics/NavigationPerformance.ts";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { ChartColumnIncreasing, LayoutGrid } from "lucide-react-native";
import { WeekCards, useWeekNavigation, StatusTag, type StatusKind } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { weekTypeTone, type PlannedWorkout, type WeekType } from "../../plans/public.ts";
import { useReportScreenTone } from "../../../../shared/ui/theme/ScreenTone.tsx";
import type { SessionStatus, WorkoutExecution, WorkoutStatus } from "../domain/ExecutionModel.ts";
import { weekStatus } from "../domain/ExecutionRules.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { weekStatusLabels, workoutStatusLabels } from "./setFormat.ts";
import { workoutProgress } from "./workoutProgress.ts";

const statusKinds: Readonly<Record<WorkoutStatus, StatusKind>> = {
  NOT_STARTED: "neutral", IN_PROGRESS: "info", COMPLETED: "success", MISSED: "warning", CANCELLED: "warning",
};

/** Неделя для панели: у Простой программы тренировки всех недель одни и те же, у Расширенной — свои. */
export interface ProgramWeekView {
  readonly index: number;
  /** Подпись недели (тип недели Расширенной программы); `null` — без подписи. */
  readonly caption: string | null;
  /** Тип недели Расширенной программы: цвет экрана и карточки недели (UI-OWN-039). */
  readonly type?: WeekType;
  readonly workouts: readonly PlannedWorkout[];
}

const kg = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} кг`;
const percent = (done: number, total: number) => total === 0 ? 0 : Math.round(done / total * 100);

/**
 * Недели программы со статусами (§48.26, §48.46): выбор недели и её тренировки. Открытие тренировки —
 * только по нажатию; завершение не переключает неделю само (§48.10, §48.72). Компоновка UI-OWN-034: карточка
 * программы (шапка, сводка недели, сетка недель с прогрессом), под ней — тренировки с объёмом и прогрессом.
 */
export function ProgramWeeksPanel({ clientId, programId, weeks: liveViews, execution, onOpenWorkout, renderWeekActions: liveActions,
  selectedWeek: liveSelected, onSelectWeek, header: liveHeader, afterCard: liveAfter, onLoaded, resetKey = "" }: Readonly<{
  clientId: string;
  programId: string;
  weeks: readonly ProgramWeekView[];
  execution: TrainingExecutionPort;
  onOpenWorkout: (weekIndex: number, workoutId: string) => void;
  /** Действия выбранной недели (например, «Изменить неделю» Расширенной программы). */
  renderWeekActions?: (weekIndex: number) => ReactNode;
  selectedWeek?: number;
  onSelectWeek?: (weekIndex: number) => void;
  /** Верх карточки программы: название, тип, действия; получает выбранную неделю. */
  header?: (weekIndex: number) => ReactNode;
  /** Между карточкой и тренировками (например, «Добавить тренировку»). */
  afterCard?: ReactNode;
  /** Статусы и выполнения загружены для `клиент:программа` (или загрузка не удалась) — экран программы может показать участника. */
  onLoaded?: (key: string) => void;
  /** Какой план показан (мезоцикл): выбор недели действует только для него, новый начинается с первой незакрытой недели. */
  resetKey?: string;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  // Статусы и выполнения хранятся вместе с тем, для чьей программы загружены: пока не пришли данные нового участника,
  // панель остаётся на прежнем виде целиком (план + статусы), а не показывает его план с чужими статусами.
  const [data, setData] = useState<Readonly<{ key: string; statuses: readonly SessionStatus[];
    executions: ReadonlyMap<string, WorkoutExecution> }>>({ key: "", statuses: [], executions: new Map() });
  const { statuses, executions } = data;
  const currentKey = `${clientId}:${programId}`;
  // Содержимое показывается из последнего снимка, у которого есть свои статусы: при смене участника план нового не
  // выводится, пока не пришли его статусы (иначе второй кадр — «Текущая»/«Не начата» и проценты меняются позже плана).
  const live = { views: liveViews, renderWeekActions: liveActions, selectedWeek: liveSelected, header: liveHeader, afterCard: liveAfter };
  const held = useRef(live);
  if (data.key === currentKey) held.current = live;
  const { views, renderWeekActions, selectedWeek, header, afterCard } = held.current;
  const [version, setVersion] = useState(0);
  const focused = useIsFocused();
  const loadedStamp = useRef("");
  const loadedExecution = useRef<TrainingExecutionPort | null>(null);
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const onSelectWeekRef = useRef(onSelectWeek);
  onSelectWeekRef.current = onSelectWeek;
  const [chosen, setChosen] = useState<Readonly<{ key: string; week: number }> | null>(null);
  const selected = chosen !== null && chosen.key === resetKey ? chosen.week : null;

  useEffect(() => {
    const stamp = JSON.stringify([clientId, programId, version]);
    if (!focused || (loadedExecution.current === execution && loadedStamp.current === stamp)) return undefined;
    let active = true;
    const endStatuses = navigationPerformance.phase("statuses");
    void Promise.all([execution.getProgramStatuses(clientId, programId), execution.listProgramExecutions(clientId, programId)])
      .then(([nextStatuses, items]) => {
        if (!active) return;
        setData({ key: `${clientId}:${programId}`, statuses: nextStatuses,
          executions: new Map(items.map((item) => [`${item.weekIndex}:${item.plannedWorkoutId}`, item.execution])) });
        loadedStamp.current = stamp;
        loadedExecution.current = execution;
        onLoadedRef.current?.(`${clientId}:${programId}`);
      }).catch(() => {
        if (!active) return;
        setData({ key: `${clientId}:${programId}`, statuses: [], executions: new Map() });
        onLoadedRef.current?.(`${clientId}:${programId}`);
      }).finally(endStatuses);
    return () => { active = false; };
  }, [clientId, execution, focused, programId, version]);

  // Пока поверх открыт дневник или матрица, статусы не перечитываются на каждую запись: один раз при возврате на экран.
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const staleWhileHidden = useRef(false);
  useEffect(() => { if (focused && staleWhileHidden.current) { staleWhileHidden.current = false; setVersion((value) => value + 1); } }, [focused]);
  useEffect(() => execution.subscribeCommittedChanges((change) => {
    if (change.clientId !== clientId || change.programId !== programId) return;
    if (focusedRef.current) setVersion((value) => value + 1); else staleWhileHidden.current = true;
  }), [clientId, execution, programId]);

  const statusOf = useMemo(() => {
    const map = new Map(statuses.map((item) => [`${item.weekIndex}:${item.plannedWorkoutId}`, item.status]));
    return (week: number, workoutId: string): WorkoutStatus => map.get(`${week}:${workoutId}`) ?? "NOT_STARTED";
  }, [statuses]);
  const weeks = views.length;
  const viewOf = (week: number) => views.find((view) => view.index === week);
  const weekOf = (week: number) => weekStatus((viewOf(week)?.workouts ?? []).map((workout) => statusOf(week, workout.id)));
  // По умолчанию — первая неделя, которая ещё не закрыта.
  const firstOpen = views.map((view) => view.index)
    .find((week) => { const status = weekOf(week); return status === "NOT_STARTED" || status === "IN_PROGRESS"; }) ?? weeks;
  const requested = selectedWeek ?? selected ?? firstOpen;
  const week = viewOf(requested) ? requested : views[0]?.index ?? 1;
  const workouts = viewOf(week)?.workouts ?? [];
  const chooseWeek = useCallback((value: number) => {
    navigationPerformance.begin("program-week");
    setChosen({ key: resetKey, week: value }); onSelectWeekRef.current?.(value);
  }, [resetKey]);
  useEffect(() => {
    if (!focused || data.key !== currentKey) return undefined;
    const frame = requestAnimationFrame(navigationPerformance.ready("program"));
    return () => cancelAnimationFrame(frame);
  }, [focused, data, currentKey, week]);
  const currentPosition = views.findIndex((view) => view.index === week);
  const previousWeek = views[currentPosition - 1];
  const nextWeek = views[currentPosition + 1];
  // «Индивидуальная» — цвет темы; остальные типы окрашивают экран (как в 2.0).
  const toneOf = (type: WeekType | undefined) => type === undefined || type === "base" ? null : weekTypeTone(type, colors);
  const weekCards = useMemo(() => views.map((view) => ({ index: view.index, caption: view.caption,
    tone: view.type === undefined ? null : toneOf(view.type) ?? colors.textMuted,
    status: view.workouts.length === 0 ? "Пусто" : view.index === firstOpen ? "Текущая" : weekStatusLabels[weekOf(view.index)] })),
  [views, statuses, colors, firstOpen]);
  useReportScreenTone(toneOf(viewOf(week)?.type));
  useWeekNavigation(weeks === 0 ? null : { week,
    previous: previousWeek ? () => chooseWeek(previousWeek.index) : null,
    next: nextWeek ? () => chooseWeek(nextWeek.index) : null });

  const progress = useMemo(() => workouts.map((workout) => workoutProgress(workout, executions.get(`${week}:${workout.id}`))),
    [workouts, executions, week]);
  const weekSets = progress.reduce((sum, item) => sum + item.sets, 0);
  const weekDone = progress.reduce((sum, item) => sum + item.done, 0);
  const completed = workouts.filter((item) => statusOf(week, item.id) === "COMPLETED").length;
  const inProgress = workouts.filter((item) => statusOf(week, item.id) === "IN_PROGRESS").length;
  const tiles: readonly Readonly<{ label: string; value: number; ink: string }>[] = [
    { label: "Тренировки", value: workouts.length, ink: colors.accentInk },
    { label: "Выполнено", value: completed, ink: colors.success },
    { label: "В процессе", value: inProgress, ink: colors.warning },
  ];
  const sectionTitle = (icon: ReactNode, title: string, right?: ReactNode) => (
    <View style={styles.sectionHead}>
      {icon}
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textSecondary }]}>{title}</Text>
      <View style={styles.grow} />
      {right}
    </View>
  );

  return (
    <View style={styles.panel}>
      {header !== undefined ? <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>{header(week)}</View> : null}
      {weeks > 0 ? <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
          {sectionTitle(<ChartColumnIncreasing size={16} color={colors.accentInk} strokeWidth={2} />, "Сводка недели")}
          <View style={styles.tiles}>
            {tiles.map((tile) => (
              <View key={tile.label} accessible accessibilityLabel={`${tile.label}: ${tile.value}`}
                style={[styles.tile, { backgroundColor: colors.surfaceRaised }]}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.tileLabel, { color: colors.textSecondary }]}>{tile.label}</Text>
                <Text style={[styles.tileValue, { color: tile.ink }]}>{tile.value}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          {sectionTitle(<LayoutGrid size={16} color={colors.accentInk} strokeWidth={2} />, "Сетка недель",
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {"Прогресс "}<Text style={[styles.strong, { color: colors.textPrimary }]}>{`${percent(weekDone, weekSets)}%`}</Text>
            </Text>)}
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View style={[styles.fill, { width: `${percent(weekDone, weekSets)}%`, backgroundColor: colors.accentFill }]} />
          </View>
          <WeekCards weeks={weekCards}
            selected={week} onSelect={chooseWeek} />
          {renderWeekActions?.(week)}
      </View> : null}
      {afterCard}
      {workouts.map((workout, index) => {
        const status = statusOf(week, workout.id);
        const item = progress[index]!;
        const share = percent(item.done, item.sets);
        return (
          <Pressable key={workout.id} accessibilityRole="button"
            accessibilityLabel={`${workout.title}, ${workoutStatusLabels[status]}, подходов ${item.done} из ${item.sets}, объём ${kg(item.volumeKg)}`}
            onPress={() => onOpenWorkout(week, workout.id)}
            style={({ pressed }) => [styles.workout, shadow.card, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
            <View style={[styles.stripe, { backgroundColor: colors.accentFill }]} />
            <View style={styles.workoutBody}>
              <View style={styles.workoutHead}>
                <Text numberOfLines={2} style={[styles.title, styles.grow, { color: colors.textPrimary }]}>{workout.title}</Text>
                <View style={styles.volume}>
                  <Text style={[styles.volumeLabel, { color: colors.textMuted }]}>Объём</Text>
                  <Text style={[styles.volumeValue, { color: colors.accentInk }]}>{kg(item.volumeKg)}</Text>
                </View>
              </View>
              <View style={styles.workoutMeta}>
                <StatusTag kind={statusKinds[status]} label={workoutStatusLabels[status]} />
                <Text style={[styles.meta, { color: colors.textSecondary }]}>
                  {item.exercises === 0 ? "Упражнений нет" : `${item.exercises} упр. · ${item.done}/${item.sets} подх.`}
                </Text>
              </View>
              <View style={styles.barRow}>
                <View style={[styles.track, { backgroundColor: colors.border }]}>
                  <View style={[styles.fill, { width: `${share}%`, backgroundColor: colors.accentFill }]} />
                </View>
                <Text style={[styles.percent, { color: colors.accentInk }]}>{`${share}%`}</Text>
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10 },
  card: { borderRadius: 22, padding: 16, gap: 12 },
  divider: { height: 1 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, textTransform: "uppercase", letterSpacing: 1 },
  tiles: { flexDirection: "row", gap: 6 },
  tile: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 4, borderRadius: 14,
    paddingHorizontal: 10, minHeight: 48 },
  tileLabel: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  tileValue: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 22 },
  meta: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17 },
  strong: { fontFamily: fonts.bold },
  workout: { flexDirection: "row", borderRadius: 22, minHeight: 64 },
  stripe: { width: 4, marginVertical: 12, marginLeft: 10, borderRadius: 2 },
  workoutBody: { flex: 1, padding: 16, paddingLeft: 12, gap: 10 },
  workoutHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  grow: { flex: 1 },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
  volume: { alignItems: "flex-end" },
  volumeLabel: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, textTransform: "uppercase", letterSpacing: 1 },
  volumeValue: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  workoutMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  percent: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, minWidth: 32, textAlign: "right" },
});
