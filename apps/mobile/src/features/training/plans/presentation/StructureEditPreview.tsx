import { StyleSheet, Text, View } from "react-native";
import { InlineNotice, SelectionChip } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseInfo } from "../domain/ExerciseLookupPort.ts";
import type { WeekEditPreview } from "../domain/PeriodizedModel.ts";
import { formatRange, setsSummary } from "../domain/SimplePlanRules.ts";

export function StructureEditPreview({ preview, names, lookup, replace, onChange }: Readonly<{
  preview: WeekEditPreview; names: ReadonlyMap<string, string>; lookup: ReadonlyMap<string, ExerciseInfo>;
  replace: readonly string[]; onChange: (keys: readonly string[]) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return <>
    {preview.affectedWeeks.map((item) => <Text key={item.clientId} style={[styles.meta, { color: colors.textSecondary }]}>
      {`${names.get(item.clientId) ?? "Участник"}: недели ${item.weeks.join(", ")}`}</Text>)}
    {preview.conflicts.length === 0 ? <Text style={[styles.meta, { color: colors.textSecondary }]}>Конфликтов нет.</Text>
      : <InlineNotice kind="info">Есть персональные отличия. Они сохранятся, пока вы явно не выберете общую правку.</InlineNotice>}
    {preview.conflicts.map((conflict) => <View key={conflict.key} style={[styles.conflict, { borderColor: colors.border }]}>
      <Text style={[styles.section, { color: colors.textPrimary }]}>{`${names.get(conflict.clientId) ?? "Участник"} · Неделя ${conflict.weekIndex}`}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{`${conflict.operation}: ${conflict.exerciseId
        ? lookup.get(conflict.exerciseId)?.name ?? "Упражнение" : conflict.workoutTitle}`}</Text>
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{conflict.reason === "PERSONAL_CHANGE" ? "План отличается от открытой недели."
        : conflict.reason === "MISSING_EXERCISE" ? "Соответствующее упражнение отсутствует."
          : conflict.reason === "MISSING_WORKOUT" ? "Соответствующая тренировка отсутствует. При применении восстановится её план из открытой недели."
            : "У участника нет этого мезоцикла. Его план останется прежним."}</Text>
      {([["Сейчас", conflict.currentExercise], ["После применения", conflict.proposedExercise]] as const)
        .map(([label, exercise]) => exercise ? <Text key={label} style={[styles.meta, { color: colors.textSecondary }]}>
          {`${label}: ${lookup.get(exercise.exerciseId)?.name ?? "Упражнение"} · ${setsSummary(exercise)}${exercise.rir
            ? ` · RIR ${formatRange(exercise.rir)}` : ""} · отдых ${exercise.restSec ?? 0} с${exercise.instruction ? ` · ${exercise.instruction}` : ""}`}
        </Text> : null)}
      {conflict.canReplace ? <View style={styles.chips}>
        <SelectionChip group="Конфликт" label="Сохранить индивидуальное" selected={!replace.includes(conflict.key)}
          onPress={() => onChange(replace.filter((key) => key !== conflict.key))} />
        <SelectionChip group="Конфликт" label="Применить общую правку" selected={replace.includes(conflict.key)}
          onPress={() => onChange([...new Set([...replace, conflict.key])])} />
      </View> : null}
    </View>)}
  </>;
}

const styles = StyleSheet.create({
  conflict: { borderTopWidth: 1, paddingTop: 8, gap: 8 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  section: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
