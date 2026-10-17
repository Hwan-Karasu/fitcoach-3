import { forwardRef, useCallback } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { SelectionChip } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { SET_TYPES, type SetType } from "../domain/ExecutionModel.ts";
import { setTypeLabels } from "./setFormat.ts";

const RPE_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Тип подхода (§48.57) и RPE 1–10 (§48.65 п. 6) — нажатием на номер подхода или ячейку RPE. */
export const SetOptionsSheet = forwardRef<BottomSheetModal, Readonly<{
  title: string;
  setType: SetType;
  rpe: number | null;
  onSetType: (type: SetType) => void;
  onRpe: (rpe: number | null) => void;
}>>(function SetOptionsSheet({ title, setType, rpe, onSetType, onRpe }, ref) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const backdrop = useCallback((props: BottomSheetBackdropProps) =>
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />, []);
  return (
    <BottomSheetModal ref={ref} backdropComponent={backdrop} backgroundStyle={{ backgroundColor: colors.canvas }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}>
      <BottomSheetView style={styles.body}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Тип подхода</Text>
        <View style={styles.wrap}>
          {SET_TYPES.map((type) => <SelectionChip key={type} group="Тип подхода" label={setTypeLabels[type]}
            selected={type === setType} onPress={() => onSetType(type)} />)}
        </View>
        <Text style={[styles.label, { color: colors.textSecondary }]}>RPE — тяжесть подхода, по желанию</Text>
        <View style={styles.grid}>
          {RPE_VALUES.map((value) => {
            const selected = value === rpe;
            return (
              <Pressable key={value} accessibilityRole="button" accessibilityLabel={`RPE ${value}`}
                accessibilityState={{ selected }} onPress={() => onRpe(selected ? null : value)}
                style={[styles.rpe, { borderColor: selected ? colors.accentFill : colors.border,
                  backgroundColor: selected ? colors.accentFill : colors.surface }]}>
                <Text style={[styles.rpeText, { color: selected ? colors.onAccentFill : colors.textPrimary }]}>{value}</Text>
              </Pressable>
            );
          })}
        </View>
        {rpe !== null ? (
          <Pressable accessibilityRole="button" onPress={() => onRpe(null)} style={styles.clear}>
            <Text style={[styles.clearText, { color: colors.accentInk }]}>Убрать RPE</Text>
          </Pressable>
        ) : null}
      </BottomSheetView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 32, gap: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, marginTop: 4 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  rpe: { width: 48, height: 48, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rpeText: { fontFamily: fonts.semibold, fontSize: 16 },
  clear: { minHeight: 48, justifyContent: "center", alignSelf: "flex-start" },
  clearText: { fontFamily: fonts.medium, fontSize: 14 },
});
