import { useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton, AppIconButton, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { PercentRangeSlider } from "../../../shared/ui/components/PercentRangeSlider.tsx";
import { EMPTY_RECIPE_FILTERS, type CalorieBand, type RecipeFilters, type RecipeSort, type TimeBand } from "../domain/RecipeBrowse.ts";

const sorts: readonly Readonly<{ id: RecipeSort; label: string }>[] = [{ id: "DEFAULT", label: "По умолчанию" }, { id: "NEWEST", label: "Сначала новые" }, { id: "OLDEST", label: "Сначала старые" }, { id: "KCAL_ASC", label: "Калории: по возрастанию" }, { id: "KCAL_DESC", label: "Калории: по убыванию" }];
const bands: readonly Readonly<{ id: CalorieBand; label: string }>[] = [{ id: "ANY", label: "Любые" }, { id: "UNDER_100", label: "Менее 100" }, { id: "100_250", label: "100–250" }, { id: "250_500", label: "250–500" }, { id: "OVER_500", label: "Более 500" }];
const times: readonly Readonly<{ id: TimeBand; label: string }>[] = [{ id: "ANY", label: "Любое время" }, { id: "UNDER_15", label: "Менее 15 мин" }, { id: "15_30", label: "15–30 мин" }, { id: "30_60", label: "30–60 мин" }, { id: "OVER_60", label: "Более 60 мин" }];
function ChoiceGrid<Id extends string>({ options, selected, label, onSelect }: Readonly<{
  options: readonly Readonly<{ id: Id; label: string }>[]; selected: Id; label: string; onSelect: (id: Id) => void;
}>) {
  return <>{Array.from({ length: Math.ceil(options.length / 2) }, (_, row) => <View key={row} style={styles.row}>
    {options.slice(row * 2, row * 2 + 2).map((option) => <SelectionChip compact fill key={option.id} group={label}
      label={option.label} selected={selected === option.id} onPress={() => onSelect(option.id)} />)}
  </View>)}</>;
}
export function RecipeBrowseControls({ filters, sort, onFilters, onSort }: Readonly<{ filters: RecipeFilters; sort: RecipeSort; onFilters: (next: RecipeFilters) => void; onSort: (next: RecipeSort) => void }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState<"FILTERS" | "SORT" | null>(null);
  const [draft, setDraft] = useState(filters);
  const [ranges, setRanges] = useState(() => Object.fromEntries(Object.entries(filters.macros).map(([key, range]) => [key, { min: String(range.min), max: String(range.max) }])) as Record<"protein" | "fat" | "carbs", { min: string; max: string }>);
  const [error, setError] = useState<string | null>(null);
  const reset = (next: RecipeFilters) => {
    setDraft(next); setRanges({ protein: { min: String(next.macros.protein.min), max: String(next.macros.protein.max) }, fat: { min: String(next.macros.fat.min), max: String(next.macros.fat.max) }, carbs: { min: String(next.macros.carbs.min), max: String(next.macros.carbs.max) } }); setError(null);
  };
  const apply = () => {
    const macros = { ...draft.macros };
    for (const key of ["protein", "fat", "carbs"] as const) {
      const min = Number(ranges[key].min.replace(",", ".")); const max = Number(ranges[key].max.replace(",", "."));
      if (ranges[key].min.trim() === "" || ranges[key].max.trim() === "" || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min > max) { setError("Диапазон — от 0 до 100 %, минимум не больше максимума."); return; }
      macros[key] = { min, max };
    }
    onFilters({ ...draft, macros }); setPanel(null);
  };
  return <>
    <View style={styles.row}><AppButton compact variant="secondary" label="Фильтры рецептов" onPress={() => { reset(filters); setPanel("FILTERS"); }} />
      <AppButton compact variant="ghost" label="Сортировать" accessibilityLabel={`Сортировать: ${sorts.find((item) => item.id === sort)?.label}`} onPress={() => setPanel("SORT")} /></View>
    <Modal visible={panel !== null} transparent animationType="fade" onRequestClose={() => setPanel(null)}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <Pressable accessible={false} importantForAccessibility="no" style={styles.scrim} onPress={() => setPanel(null)} />
      <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.header}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{panel === "SORT" ? "Сортировать рецепты" : "Фильтры рецептов"}</Text>
        <AppIconButton label="Закрыть меню рецептов" icon={<X size={20} color={colors.iconPrimary} />} onPress={() => setPanel(null)} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {panel === "SORT" ? <ChoiceGrid options={sorts} selected={sort} label="Сортировка рецептов" onSelect={(id) => { onSort(id); setPanel(null); }} /> : <>
            <View style={[styles.block, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>Калории за порцию</Text>
              <ChoiceGrid options={bands} selected={draft.calories} label="Калории за порцию" onSelect={(calories) => setDraft({ ...draft, calories })} />
            </View>
            <View style={[styles.block, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>Время приготовления</Text>
              <ChoiceGrid options={times} selected={draft.time} label="Время рецепта" onSelect={(time) => setDraft({ ...draft, time })} />
            </View>
            <View style={[styles.block, { backgroundColor: colors.surfaceRaised }]}>
            <Text style={[styles.label, { color: colors.textPrimary }]}>Доли БЖУ, %</Text>
            {(["protein", "fat", "carbs"] as const).map((key) => <View key={key} style={styles.macro}>
              <View style={styles.macroHeader}><Text style={[styles.macroLabel, { color: colors.textPrimary }]}>{key === "protein" ? "Белки" : key === "fat" ? "Жиры" : "Углеводы"}</Text>
              {(["min", "max"] as const).map((bound) => <View key={bound} style={styles.cell}><TextField compact label={bound === "min" ? "От, %" : "До, %"} keyboardType="decimal-pad" value={ranges[key][bound]} onChangeText={(text) => setRanges((current) => ({ ...current, [key]: { ...current[key], [bound]: text } }))} /></View>)}</View>
              <PercentRangeSlider label={key === "protein" ? "Белки" : key === "fat" ? "Жиры" : "Углеводы"}
                min={Math.max(0, Math.min(100, Number(ranges[key].min.replace(",", ".")) || 0))} max={Math.max(0, Math.min(100, Number(ranges[key].max.replace(",", ".")) || 0))}
                onChange={(min, max) => setRanges((current) => ({ ...current, [key]: { min: String(min), max: String(max) } }))} />
            </View>)}
            </View>
            {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
          </>}
        </ScrollView>
        {panel === "FILTERS" ? <View style={styles.row}>
          <View style={styles.cell}><AppButton compact size="small" variant="secondary" label="Сбросить" onPress={() => reset(EMPTY_RECIPE_FILTERS)} /></View>
          <View style={styles.cell}><AppButton compact size="small" label="Применить" onPress={apply} /></View>
        </View> : null}
      </View></KeyboardAvoidingView>
    </Modal>
  </>;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 6 }, cell: { flex: 1, minWidth: 0 },
  body: { gap: 10 }, scroll: { flexGrow: 0, flexShrink: 1 },
  backdrop: { flex: 1, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  scrim: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { width: "100%", maxWidth: 420, maxHeight: "100%", padding: 12, borderWidth: 1, borderRadius: 20, gap: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  block: { borderRadius: 14, padding: 10, gap: 7 }, macro: { gap: 2 },
  macroHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  macroLabel: { width: 66, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
});
