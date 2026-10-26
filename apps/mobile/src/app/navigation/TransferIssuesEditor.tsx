import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, TextField } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import type { TrainingTransfer } from "../../features/import/public.ts";
import { excelColumnName } from "./WorkbookColumnSettings.tsx";

const labels = { reps: "Фактические повторения", loadGrams: "Вес, кг", durationSec: "Время, сек", distanceM: "Расстояние, м", rpe: "RPE" };
export function TransferIssuesEditor({ value, busy, onCorrect }: Readonly<{
  value: TrainingTransfer; busy: boolean; onCorrect: (id: string, correction: string) => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const [inputs, setInputs] = useState<Readonly<Record<string, string>>>({});
  if (!value.issues?.length) return null;
  return <View style={styles.block}>
    <Text style={[styles.heading, { color: colors.textPrimary }]}>Проверьте значения ({value.issues.length})</Text>
    <Text style={[styles.body, { color: colors.textSecondary }]}>В фактическом результате нужно одно число. Введите верное значение или явно оставьте его пустым. Остальные данные сохранятся.</Text>
    {value.issues.map((issue) => {
      const session = value.sessions.find((item) => item.facts.some((fact) => fact.id === issue.targetId));
      const fact = session?.facts.find((item) => item.id === issue.targetId);
      const program = value.programs.find((item) => item.id === issue.programId);
      const workouts = program?.simple?.workouts ?? program?.mesocycles.flatMap((cycle) => cycle.weeks.flatMap((week) => week.workouts)) ?? [];
      const workout = workouts.find((item) => item.id === (session?.plannedWorkoutId ?? issue.workoutId));
      const exercise = fact ? workout?.exercises.find((item) => item.id === fact.plannedExerciseId)
        : workout?.exercises.find((item) => item.sets.some((set) => set.id === issue.targetId));
      const name = value.exercises.find((item) => item.id === (fact?.exerciseId ?? exercise?.exerciseId))?.name ?? "Упражнение";
      const position = fact ? fact.position + 1 : (exercise?.sets.findIndex((set) => set.id === issue.targetId) ?? -1) + 1;
      const location = issue.source ? `Лист «${issue.source.sheet}», ${excelColumnName(issue.source.column - 1)}${issue.source.row}` : "";
      const title = `${name} · неделя ${session?.weekIndex ?? issue.weekIndex ?? "?"} · ${workout?.title ?? "Тренировка"} · подход ${position}`;
      return <View key={issue.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.textPrimary }]}>{title}</Text>
        {!!location && <Text style={[styles.body, { color: colors.textSecondary }]}>{location}</Text>}
        <Text style={[styles.body, { color: colors.textPrimary }]}>{`${labels[issue.field]}: «${issue.raw}»`}</Text>
        <TextField label="Корректное число" hint={`${title}. ${labels[issue.field]}`} keyboardType="decimal-pad"
          value={inputs[issue.id] ?? ""} onChangeText={(text) => setInputs((current) => ({ ...current, [issue.id]: text }))} />
        <View style={styles.row}>
          <View style={styles.grow}><AppButton compact label="Применить" disabled={busy || !inputs[issue.id]?.trim()} onPress={() => onCorrect(issue.id, inputs[issue.id]!)} /></View>
          <View style={styles.grow}><AppButton compact variant="secondary" label="Оставить пустым" disabled={busy} onPress={() => onCorrect(issue.id, "пусто")} /></View>
        </View>
      </View>;
    })}
  </View>;
}
const styles = StyleSheet.create({ block: { gap: 10 }, card: { padding: 12, borderWidth: 1, borderRadius: 12, gap: 8 },
  heading: { fontFamily: fonts.semibold, fontSize: 16 }, label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 }, row: { flexDirection: "row", gap: 8 }, grow: { flex: 1 } });
