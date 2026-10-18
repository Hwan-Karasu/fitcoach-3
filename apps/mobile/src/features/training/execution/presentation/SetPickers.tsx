import { forwardRef, useCallback, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Check } from "lucide-react-native";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { SET_TYPES, type SetType } from "../domain/ExecutionModel.ts";
import { rpeTone, setTypeHints, setTypeLabels, setTypeTone } from "./setFormat.ts";

const RPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const PickerSheet = forwardRef<BottomSheetModal, Readonly<{ title: string; children: ReactNode }>>(function PickerSheet(
  { title, children }, ref) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const backdrop = useCallback((props: BottomSheetBackdropProps) =>
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />, []);
  return (
    <BottomSheetModal ref={ref} backdropComponent={backdrop} backgroundStyle={{ backgroundColor: colors.canvas }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}>
      <BottomSheetView style={styles.body}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {children}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

/** Тип подхода (§48.57): нажатие на номер подхода. Выбор сразу закрывает окно. */
export const SetTypeSheet = forwardRef<BottomSheetModal, Readonly<{
  setType: SetType;
  /** Добавленный разминочный подход: тип не меняется, его можно только удалить. */
  extra: boolean;
  onSelect: (type: SetType) => void;
  onRemove: () => void;
}>>(function SetTypeSheet({ setType, extra, onSelect, onRemove }, ref) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  if (extra) {
    return (
      <PickerSheet ref={ref} title="Разминочный подход">
        <Text style={[styles.optionHint, { color: colors.textSecondary }]}>
          Добавлен к плану на эту тренировку. Удаление уберёт только его — плановые подходы останутся.
        </Text>
        <Pressable accessibilityRole="button" onPress={onRemove}
          style={[styles.option, { borderColor: colors.danger, backgroundColor: withAlpha(colors.danger, 0.1) }]}>
          <Text style={[styles.optionTitle, { color: colors.danger }]}>Удалить подход</Text>
        </Pressable>
      </PickerSheet>
    );
  }
  return (
    <PickerSheet ref={ref} title="Тип подхода">
      {SET_TYPES.map((type) => {
        const tone = setTypeTone(type, colors) ?? colors.textSecondary;
        const selected = type === setType;
        return (
          <Pressable key={type} accessibilityRole="radio" accessibilityState={{ checked: selected }}
            accessibilityLabel={`${setTypeLabels[type]}. ${setTypeHints[type]}`} onPress={() => onSelect(type)}
            style={[styles.option, { borderColor: selected ? tone : colors.border,
              backgroundColor: type === "NORMAL" ? colors.surface : withAlpha(tone, 0.14) }]}>
            <View style={[styles.swatch, { backgroundColor: type === "NORMAL" ? colors.input : tone }]} />
            <View style={styles.optionText}>
              <Text style={[styles.optionTitle, { color: colors.textPrimary }]}>{setTypeLabels[type]}</Text>
              <Text style={[styles.optionHint, { color: colors.textSecondary }]}>{setTypeHints[type]}</Text>
            </View>
            {selected ? <Check size={20} color={colors.textPrimary} strokeWidth={2.2} /> : null}
          </Pressable>
        );
      })}
    </PickerSheet>
  );
});

/** RPE 1–10 одним рядом (§48.65 п. 6): нажатие на ячейку RPE; повторное нажатие на выбранное — убрать. */
export const RpeSheet = forwardRef<BottomSheetModal, Readonly<{
  rpe: number | null;
  onSelect: (rpe: number | null) => void;
}>>(function RpeSheet({ rpe, onSelect }, ref) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <PickerSheet ref={ref} title="RPE — тяжесть подхода">
      <View style={styles.rpeRow}>
        {RPE_VALUES.map((value) => {
          const selected = value === rpe;
          const tone = rpeTone(value, colors);
          return (
            <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: selected }}
              accessibilityLabel={`RPE ${value}`} hitSlop={{ top: 6, bottom: 6 }} onPress={() => onSelect(selected ? null : value)}
              style={[styles.rpe, { borderColor: selected ? tone : colors.border,
                backgroundColor: selected ? tone : withAlpha(tone, 0.12) }]}>
              <Text style={[styles.rpeText, { color: selected ? colors.canvas : colors.textPrimary }]}>{value}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.optionHint, { color: colors.textSecondary }]}>1 — очень легко, 10 — предел. По желанию.</Text>
      {rpe !== null ? (
        <Pressable accessibilityRole="button" onPress={() => onSelect(null)} style={styles.clear}>
          <Text style={[styles.clearText, { color: colors.danger }]}>Убрать RPE</Text>
        </Pressable>
      ) : null}
    </PickerSheet>
  );
});

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32, gap: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22, marginBottom: 2 },
  option: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56, borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 8 },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  optionText: { flex: 1, gap: 2 },
  optionTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  optionHint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  rpeRow: { flexDirection: "row", gap: 4 },
  rpe: { flex: 1, minWidth: 0, height: 44, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rpeText: { fontFamily: fonts.semibold, fontSize: 15 },
  clear: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
  clearText: { fontFamily: fonts.medium, fontSize: 14 },
});
