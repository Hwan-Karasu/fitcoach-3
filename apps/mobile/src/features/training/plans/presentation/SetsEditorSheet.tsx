import { forwardRef, useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView, BottomSheetTextInput,
  type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Copy, Plus, Trash2, X } from "lucide-react-native";
import { AppButton, AppIconButton } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ExerciseInfo } from "../domain/ExerciseLookupPort.ts";
import type { PlannedExercise, PlannedSet } from "../domain/SimplePlanModel.ts";
import { formatDuration, parseDuration, parseLoad, setFieldsOf, type SetField } from "../domain/SimplePlanRules.ts";

const columnLabels: Readonly<Record<SetField, string>> = { loadGrams: "Вес, кг", reps: "Повторы", durationSec: "Время", distanceM: "Метры" };

function rawOf(set: PlannedSet, field: SetField): string {
  const value = set[field];
  if (value === null) return "";
  if (field === "loadGrams") return String(value / 1000).replace(".", ",");
  if (field === "durationSec") return formatDuration(value);
  return String(value);
}

function parseField(field: SetField, text: string): number | null | "invalid" {
  if (field === "loadGrams") return parseLoad(text);
  if (field === "durationSec") return parseDuration(text);
  const value = text.trim();
  if (value === "") return null;
  return /^\d+$/.test(value) ? Number(value) : "invalid";
}

/** Ячейка значения: свой текст ввода, в черновик уходит только разобранное значение. */
function SetCell({ set, field, onCommit }: Readonly<{ set: PlannedSet; field: SetField; onCommit: (value: number | null) => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [text, setText] = useState(() => rawOf(set, field));
  const [invalid, setInvalid] = useState(false);
  return (
    <BottomSheetTextInput value={text} keyboardType={field === "durationSec" ? "numbers-and-punctuation" : "decimal-pad"}
      accessibilityLabel={columnLabels[field]} placeholder="—" placeholderTextColor={colors.textMuted}
      onChangeText={(next) => {
        setText(next);
        const parsed = parseField(field, next);
        setInvalid(parsed === "invalid");
        if (parsed !== "invalid") onCommit(parsed);
      }}
      style={[styles.cell, { color: colors.textPrimary, backgroundColor: colors.input,
        borderColor: invalid ? colors.danger : colors.border }]} />
  );
}

/** Подходы упражнения в нижнем окне: колонки по профилю учёта, копия подхода, удаление. */
export const SetsEditorSheet = forwardRef<BottomSheetModal, Readonly<{
  exercise: PlannedExercise | null;
  info: ExerciseInfo | null;
  onChangeSet: (setId: string, field: SetField, value: number | null) => void;
  onAddSet: () => void;
  onRemoveSet: (setId: string) => void;
  onFillAll: () => void;
  onRemoveExercise: () => void;
  onDismiss: () => void;
}>>(function SetsEditorSheet({ exercise, info, onChangeSet, onAddSet, onRemoveSet, onFillAll, onRemoveExercise, onDismiss }, ref) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const fields = info === null ? [] : setFieldsOf(info.metrics);
  const backdrop = useCallback((props: BottomSheetBackdropProps) =>
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />, []);
  return (
    <BottomSheetModal ref={ref} snapPoints={["75%"]} enableDynamicSizing={false} onDismiss={onDismiss}
      backdropComponent={backdrop} keyboardBehavior="interactive" keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize" backgroundStyle={{ backgroundColor: colors.canvas }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}>
      {exercise !== null ? (
        <BottomSheetScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.head}>
            <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>{info?.name ?? "Упражнение"}</Text>
            <AppIconButton compact label="Закрыть" icon={<X size={20} color={colors.textPrimary} strokeWidth={1.8} />}
              onPress={() => (ref as { current: BottomSheetModal | null } | null)?.current?.dismiss()} />
          </View>
          <View style={styles.row}>
            <Text style={[styles.index, styles.headText, { color: colors.textMuted }]}>№</Text>
            {fields.map((field) => <Text key={field} style={[styles.headCell, styles.headText, { color: colors.textMuted }]}>{columnLabels[field]}</Text>)}
            <View style={styles.action} />
          </View>
          {exercise.sets.map((set, index) => (
            <View key={set.id} style={styles.row}>
              <Text style={[styles.index, { color: colors.textSecondary }]}>{index + 1}</Text>
              {fields.map((field) => (
                <View key={field} style={styles.cellWrap}>
                  <SetCell set={set} field={field} onCommit={(value) => onChangeSet(set.id, field, value)} />
                </View>
              ))}
              <AppIconButton compact label={`Удалить подход ${index + 1}`} disabled={exercise.sets.length === 1}
                icon={<Trash2 size={18} color={colors.textSecondary} strokeWidth={1.8} />} onPress={() => onRemoveSet(set.id)} />
            </View>
          ))}
          <View style={styles.actions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Добавить подход — копия последнего" onPress={onAddSet}
              style={({ pressed }) => [styles.add, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
              <Plus size={16} color={colors.accentInk} strokeWidth={2} />
              <Text style={[styles.addText, { color: colors.accentInk }]}>Подход</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Заполнить все подходы как первый" onPress={onFillAll}
              style={({ pressed }) => [styles.add, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
              <Copy size={16} color={colors.accentInk} strokeWidth={2} />
              <Text style={[styles.addText, { color: colors.accentInk }]}>Все как первый</Text>
            </Pressable>
          </View>
          <Text style={[styles.note, { color: colors.textMuted }]}>Пустое значение можно заполнить позже. Время — «1:30» или секунды.</Text>
          <AppButton variant="secondary" label="Убрать упражнение из тренировки" onPress={onRemoveExercise} />
        </BottomSheetScrollView>
      ) : null}
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  body: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  index: { width: 24, textAlign: "center", fontFamily: fonts.medium, fontSize: 14 },
  headText: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  headCell: { flex: 1, textAlign: "center" },
  cellWrap: { flex: 1 },
  cell: { minHeight: 44, borderWidth: 1, borderRadius: 8, textAlign: "center", fontFamily: fonts.medium, fontSize: 16 },
  action: { width: 40 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  add: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  addText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
