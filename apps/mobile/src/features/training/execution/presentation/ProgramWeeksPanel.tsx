import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChartColumnIncreasing, LayoutGrid } from "lucide-react-native";
import { WeekCards, useWeekNavigation, StatusTag, type StatusKind } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { PlannedWorkout } from "../../plans/public.ts";
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
  readonly workouts: readonly PlannedWorkout[];
}

const kg = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} кг`;
const percent = (done: number, total: number) => total === 0 ? 0 : Math.round(done / total * 100);

/**
 * Недели программы со статусами (§48.26, §48.46): выбор недели и её тренировки. Открытие тренировки —
 * только по нажатию; завершение не переключает неделю само (§48.10, §48.72). Компоновка UI-OWN-034: карточка
 * программы (шапка, сводка недели, сетка недель с прогрессом), под ней — тренировки с объёмом и прогрессом.
 */
export function ProgramWeeksPanel({ clientId, programId, weeks: views, execution, onOpenWorkout, renderWeekActions,
  selectedWeek, onSelectWeek, header, afterCard }: Readonly<{
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
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [statuses, setStatuses] = useState<readonly SessionStatus[]>([]);
  const [executions, setExecutions] = useState<ReadonlyMap<string, WorkoutExecution>>(new Map());
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([execution.getProgramStatuses(clientId, programId), execution.listProgramExecutions(clientId, programId)])
      .then(([nextStatuses, items]) => {
        if (!active) return;
        setStatuses(nextStatuses);
        setExecutions(new Map(items.map((item) => [`${item.weekIndex}:${item.plannedWorkoutId}`, item.execution])));
      }).catch(() => undefined);
    return () => { active = false; };
  }, [clientId, execution, programId, version]);

  useEffect(() => execution.subscribeCommittedChanges((change) => {
    if (change.clientId === clientId && change.programId === programId) setVersion((value) => value + 1);
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
  const chooseWeek = (value: number) => { setSelected(value); onSelectWeek?.(value); };
  const currentPosition = views.findIndex((view) => view.index === week);
  const previousWeek = views[currentPosition - 1];
  const nextWeek = views[currentPosition + 1];
  useWeekNavigation(weeks === 0 ? null : { week,
    previous: previousWeek ? () => chooseWeek(previousWeek.index) : null,
    next: nextWeek ? () => chooseWeek(nextWeek.index) : null });

  const progress = workouts.map((workout) => workoutProgress(workout, executions.get(`${week}:${workout.id}`)));
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
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {header?.(week)}
        {weeks > 0 ? <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          {sectionTitle(<ChartColumnIncreasing size={16} color={colors.accentInk} strokeWidth={2} />, "Сводка недели")}
          <View style={styles.tiles}>
            {tiles.map((tile) => (
              <View key={tile.label} accessible accessibilityLabel={`${tile.label}: ${tile.value}`}
                style={[styles.tile, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
                <Text numberOfLines={1} style={[styles.tileLabel, { color: colors.textSecondary }]}>{tile.label}</Text>
                <Text style={[styles.tileValue, { color: tile.ink }]}>{tile.value}</Text>
              </View>
            ))}
          </View>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          {sectionTitle(<LayoutGrid size={16} color={colors.accentInk} strokeWidth={2} />, "Сетка недель",
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {"Прогресс "}<Text style={[styles.strong, { color: colors.textPrimary }]}>{`${percent(weekDone, weekSets)}%`}</Text>
            </Text>)}
          <WeekCards weeks={views.map((view) => ({ index: view.index, caption: view.caption, status: weekStatusLabels[weekOf(view.index)] }))}
            selected={week} onSelect={chooseWeek} />
          {renderWeekActions?.(week)}
        </> : null}
      </View>
      {afterCard}
      {workouts.map((workout, index) => {
        const status = statusOf(week, workout.id);
        const item = progress[index]!;
        const share = percent(item.done, item.sets);
        return (
          <Pressable key={workout.id} accessibilityRole="button"
            accessibilityLabel={`${workout.title}, ${workoutStatusLabels[status]}, подходов ${item.done} из ${item.sets}, объём ${kg(item.volumeKg)}`}
            onPress={() => onOpenWorkout(week, workout.id)}
            style={({ pressed }) => [styles.workout, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface,
              borderColor: colors.border }]}>
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
                <View style={[styles.track, { backgroundColor: colors.surfaceRaised }]}>
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
  card: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 10 },
  divider: { height: StyleSheet.hairlineWidth },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, textTransform: "uppercase", letterSpacing: 0.6 },
  tiles: { flexDirection: "row", gap: 8 },
  tile: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6, borderWidth: 1,
    borderRadius: 12, paddingHorizontal: 10, minHeight: 48 },
  tileLabel: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 11, lineHeight: 14 },
  tileValue: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 24 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  strong: { fontFamily: fonts.bold },
  workout: { flexDirection: "row", borderWidth: 1, borderRadius: 14, overflow: "hidden", minHeight: 64 },
  stripe: { width: 4, marginVertical: 12, marginLeft: 10, borderRadius: 2 },
  workoutBody: { flex: 1, padding: 12, paddingLeft: 10, gap: 8 },
  workoutHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  grow: { flex: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  volume: { alignItems: "flex-end" },
  volumeLabel: { fontFamily: fonts.semibold, fontSize: 10, lineHeight: 13, textTransform: "uppercase", letterSpacing: 0.6 },
  volumeValue: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  workoutMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 },
  barRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  percent: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, minWidth: 32, textAlign: "right" },
});
