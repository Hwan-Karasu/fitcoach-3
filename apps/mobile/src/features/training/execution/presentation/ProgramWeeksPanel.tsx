import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { SelectionChip, StatusTag, type StatusKind } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { PlannedWorkout } from "../../plans/public.ts";
import type { SessionStatus, WeekStatus, WorkoutStatus } from "../domain/ExecutionModel.ts";
import { weekStatus } from "../domain/ExecutionRules.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";
import { weekStatusLabels, workoutStatusLabels } from "./setFormat.ts";

const statusKinds: Readonly<Record<WorkoutStatus, StatusKind>> = {
  NOT_STARTED: "neutral", IN_PROGRESS: "info", COMPLETED: "success", MISSED: "warning", CANCELLED: "warning",
};

const weekMarks: Readonly<Record<WeekStatus, string>> = { NOT_STARTED: "", IN_PROGRESS: " •", COMPLETED: " ✓", CLOSED_WITH_DEVIATIONS: " ✓!" };

/** Неделя для панели: у Простой программы тренировки всех недель одни и те же, у Расширенной — свои. */
export interface ProgramWeekView {
  readonly index: number;
  /** Подпись недели (тип недели Расширенной программы); `null` — без подписи. */
  readonly caption: string | null;
  readonly workouts: readonly PlannedWorkout[];
}

/**
 * Недели программы со статусами (§48.26, §48.46): выбор недели и её тренировки. Открытие тренировки —
 * только по нажатию; завершение не переключает неделю само (§48.10, §48.72).
 */
export function ProgramWeeksPanel({ clientId, programId, weeks: views, execution, onOpenWorkout, renderWeekActions }: Readonly<{
  clientId: string;
  programId: string;
  weeks: readonly ProgramWeekView[];
  execution: TrainingExecutionPort;
  onOpenWorkout: (weekIndex: number, workoutId: string) => void;
  /** Действия выбранной недели (например, «Изменить неделю» Расширенной программы). */
  renderWeekActions?: (weekIndex: number) => ReactNode;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [statuses, setStatuses] = useState<readonly SessionStatus[]>([]);
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    execution.getProgramStatuses(clientId, programId).then((next) => { if (active) setStatuses(next); }).catch(() => undefined);
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
  const viewOf = (week: number) => views[week - 1];
  const weekOf = (week: number) => weekStatus((viewOf(week)?.workouts ?? []).map((workout) => statusOf(week, workout.id)));
  // По умолчанию — первая неделя, которая ещё не закрыта.
  const firstOpen = Array.from({ length: weeks }, (_, index) => index + 1)
    .find((week) => { const status = weekOf(week); return status === "NOT_STARTED" || status === "IN_PROGRESS"; }) ?? weeks;
  const week = Math.min(selected ?? firstOpen, weeks);
  const caption = viewOf(week)?.caption ?? null;
  const workouts = viewOf(week)?.workouts ?? [];

  return (
    <View style={styles.panel}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.weeks}>
        {Array.from({ length: weeks }, (_, index) => index + 1).map((item) => (
          <SelectionChip key={item} group="Неделя" label={`Неделя ${item}${weekMarks[weekOf(item)]}`} selected={item === week}
            onPress={() => setSelected(item)} />
        ))}
      </ScrollView>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{`Неделя ${week}${caption === null ? "" : ` · ${caption}`}: ${weekStatusLabels[weekOf(week)].toLowerCase()}`}</Text>
      {workouts.map((workout) => {
        const status = statusOf(week, workout.id);
        return (
          <Pressable key={workout.id} accessibilityRole="button"
            accessibilityLabel={`${workout.title}, ${workoutStatusLabels[status]}`}
            onPress={() => onOpenWorkout(week, workout.id)}
            style={[styles.workout, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.grow}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{workout.title}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {workout.exercises.length === 0 ? "Упражнений нет" : `Упражнений: ${workout.exercises.length}`}
              </Text>
            </View>
            <StatusTag kind={statusKinds[status]} label={workoutStatusLabels[status]} />
            <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} />
          </Pressable>
        );
      })}
      {weeks > 0 ? renderWeekActions?.(week) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10 },
  weeks: { gap: 8, paddingRight: 8 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  workout: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 64 },
  grow: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
});
