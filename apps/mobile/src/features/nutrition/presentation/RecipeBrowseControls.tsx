import { useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { PercentRangeSlider } from "../../../shared/ui/components/PercentRangeSlider.tsx";
import { EMPTY_RECIPE_FILTERS, type CalorieBand, type RecipeFilters, type RecipeSort, type TimeBand } from "../domain/RecipeBrowse.ts";

const sorts: readonly Readonly<{ id: RecipeSort; label: string }>[] = [{ id: "DEFAULT", label: "По умолчанию" }, { id: "NEWEST", label: "Сначала новые" }, { id: "OLDEST", label: "Сначала старые" }, { id: "KCAL_ASC", label: "Калории: по возрастанию" }, { id: "KCAL_DESC", label: "Калории: по убыванию" }];
const bands: readonly Readonly<{ id: CalorieBand; label: string }>[] = [{ id: "ANY", label: "Любые" }, { id: "UNDER_100", label: "Менее 100" }, { id: "100_250", label: "100–250" }, { id: "250_500", label: "250–500" }, { id: "OVER_500", label: "Более 500" }];
const times: readonly Readonly<{ id: TimeBand; label: string }>[] = [{ id: "ANY", label: "Любое время" }, { id: "UNDER_15", label: "Менее 15 мин" }, { id: "15_30", label: "15–30 мин" }, { id: "30_60", label: "30–60 мин" }, { id: "OVER_60", label: "Более 60 мин" }];
export function RecipeBrowseControls({ filters, sort, onFilters, onSort }: Readonly<{ filters: RecipeFilters; sort: RecipeSort; onFilters: (next: RecipeFilters) => void; onSort: (next: RecipeSort) => void }>) {
  const colors = usePrototypeTheme().palette.tokens;
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
    <Modal visible={panel !== null} transparent animationType="slide" onRequestClose={() => setPanel(null)}>
      <View style={styles.backdrop}><View style={[styles.sheet, { backgroundColor: colors.surface }]}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{panel === "SORT" ? "Сортировать рецепты" : "Фильтры рецептов"}</Text>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {panel === "SORT" ? sorts.map((item) => <AppButton key={item.id} variant={sort === item.id ? "primary" : "ghost"} label={item.label} onPress={() => { onSort(item.id); setPanel(null); }} />) : <>
            <Text style={{ color: colors.textPrimary }}>Калории за порцию</Text><View style={styles.wrap}>{bands.map((band) => <SelectionChip key={band.id} group="Калории за порцию" label={band.label} selected={draft.calories === band.id} onPress={() => setDraft({ ...draft, calories: band.id })} />)}</View>
            <Text style={{ color: colors.textPrimary }}>Подготовка и приготовление</Text><View style={styles.wrap}>{times.map((time) => <SelectionChip key={time.id} group="Время рецепта" label={time.label} selected={draft.time === time.id} onPress={() => setDraft({ ...draft, time: time.id })} />)}</View>
            <Text style={{ color: colors.textSecondary }}>Доли энергии из Б/Ж/У (4/9/4), %. При активном фильтре рецепты с неизвестными БЖУ исключаются.</Text>
            {(["protein", "fat", "carbs"] as const).map((key) => <View key={key} style={styles.body}>
              <Text style={{ color: colors.textPrimary }}>{key === "protein" ? "Белки" : key === "fat" ? "Жиры" : "Углеводы"}</Text>
              <View style={styles.row}>{(["min", "max"] as const).map((bound) => <View key={bound} style={{ flex: 1 }}><TextField label={bound === "min" ? "Мин. %" : "Макс. %"} keyboardType="decimal-pad" value={ranges[key][bound]} onChangeText={(text) => setRanges((current) => ({ ...current, [key]: { ...current[key], [bound]: text } }))} /></View>)}</View>
              <PercentRangeSlider label={key === "protein" ? "Белки" : key === "fat" ? "Жиры" : "Углеводы"}
                min={Math.max(0, Math.min(100, Number(ranges[key].min.replace(",", ".")) || 0))} max={Math.max(0, Math.min(100, Number(ranges[key].max.replace(",", ".")) || 0))}
                onChange={(min, max) => setRanges((current) => ({ ...current, [key]: { min: String(min), max: String(max) } }))} />
            </View>)}
            {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
            <AppButton variant="ghost" label="Сбросить фильтры" onPress={() => reset(EMPTY_RECIPE_FILTERS)} />
          </>}
        </ScrollView>
        {panel === "FILTERS" ? <AppButton label="Готово" onPress={apply} /> : null}
        <AppButton variant="ghost" label="Закрыть без изменений" onPress={() => setPanel(null)} />
      </View></View>
    </Modal>
  </>;
}
const styles = StyleSheet.create({ row: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, wrap: { flexDirection: "row", gap: 8, flexWrap: "wrap" }, body: { gap: 12 }, backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.45)" }, sheet: { maxHeight: "90%", padding: 16, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: 12 }, title: { fontFamily: fonts.bold, fontSize: 18 } });
