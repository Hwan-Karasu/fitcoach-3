import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton, AppIconButton, SelectionChip } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { PercentRangeSlider } from "../../../shared/ui/components/PercentRangeSlider.tsx";
import { EMPTY_RECIPE_FILTERS, choiceRows, parseNumberRange, type CalorieBand, type RecipeFilters, type RecipeSort, type TimeBand } from "../domain/RecipeBrowse.ts";
import { scrim } from "../../../shared/ui/theme/style.ts";

const sorts: readonly Readonly<{ id: RecipeSort; label: string }>[] = [{ id: "DEFAULT", label: "По умолчанию" }, { id: "NEWEST", label: "Сначала новые" }, { id: "OLDEST", label: "Сначала старые" }, { id: "KCAL_ASC", label: "Калорийность ↑" }, { id: "KCAL_DESC", label: "Калорийность ↓" }];
const bands: readonly Readonly<{ id: CalorieBand; label: string }>[] = [{ id: "ANY", label: "Любые" }, { id: "UNDER_100", label: "Менее 100" }, { id: "100_250", label: "100–250" }, { id: "250_500", label: "250–500" }, { id: "OVER_500", label: "Более 500" }];
const times: readonly Readonly<{ id: TimeBand; label: string }>[] = [{ id: "ANY", label: "Любое время" }, { id: "UNDER_15", label: "Менее 15 мин" }, { id: "15_30", label: "15–30 мин" }, { id: "30_60", label: "30–60 мин" }, { id: "OVER_60", label: "Более 60 мин" }];
const KCAL_LIMIT = 5000;
const MINUTES_LIMIT = 10_080;
const macroNames = { protein: "Белки", fat: "Жиры", carbs: "Углеводы" } as const;
type MacroKey = keyof typeof macroNames;
type Texts = Readonly<Record<MacroKey, Readonly<{ min: string; max: string }>>>;
const text = (value: number | null) => (value === null ? "" : String(value));
const macroTexts = (filters: RecipeFilters): Texts => ({
  protein: { min: String(filters.macros.protein.min), max: String(filters.macros.protein.max) },
  fat: { min: String(filters.macros.fat.min), max: String(filters.macros.fat.max) },
  carbs: { min: String(filters.macros.carbs.min), max: String(filters.macros.carbs.max) },
});

/**
 * Варианты по макету владельца (UIX-FIT-12): первый («По умолчанию», «Любые», «Любое время») — на всю ширину, остальные — по два в ряд
 * (`choiceRows`). Одиночный последний вариант занимает одну колонку и стоит по центру ряда.
 */
function ChoiceGrid<Id extends string>({ options, selected, label, onSelect }: Readonly<{
  options: readonly Readonly<{ id: Id; label: string }>[]; selected: Id; label: string; onSelect: (id: Id) => void;
}>) {
  return <>{choiceRows(options).map((rowOptions, row) => {
    const lead = row === 0;
    return <View key={row} style={[styles.row, styles.rowCentered]}>
      {rowOptions.map((option) => <View key={option.id} style={[styles.choice, { flexBasis: lead ? "100%" : "48.5%", flexGrow: lead || rowOptions.length === 2 ? 1 : 0 }]}>
        <SelectionChip compact fill group={label} label={option.label} selected={selected === option.id} onPress={() => onSelect(option.id)} />
      </View>)}
    </View>;
  })}</>;
}

/** Название фильтра отдельной строкой на всю ширину: пилюли «от — до» больше не теснят его в левый край. */
function BlockTitle({ children, muted = false }: Readonly<{ children: string; muted?: boolean }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return <Text style={[styles.label, { color: muted ? colors.textSecondary : colors.textPrimary }]}>{children}</Text>;
}

/** «от — до» + единица по центру блока. */
function RangeRow({ children }: Readonly<{ children: ReactNode }>) {
  return <View style={styles.rangeRow}>{children}</View>;
}

/** Поле числа 32 dp: для «от / до» и процентов; название — для экранных читалок. */
function NumberBox({ value, onChange, label, decimal = false, placeholder }: Readonly<{ value: string; onChange: (next: string) => void; label: string; decimal?: boolean; placeholder?: string }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return <TextInput value={value} onChangeText={(next) => onChange(next.replace(decimal ? /[^\d.,]/gu : /\D/gu, "").slice(0, 6))}
    keyboardType={decimal ? "decimal-pad" : "number-pad"} placeholder={placeholder} placeholderTextColor={colors.textMuted} accessibilityLabel={label} selectTextOnFocus
    style={[styles.box, { color: colors.textPrimary, backgroundColor: colors.input, borderColor: colors.border }]} />;
}

export function RecipeBrowseControls({ filters, sort, onFilters, onSort }: Readonly<{ filters: RecipeFilters; sort: RecipeSort; onFilters: (next: RecipeFilters) => void; onSort: (next: RecipeSort) => void }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const insets = useSafeAreaInsets();
  const [panel, setPanel] = useState<"FILTERS" | "SORT" | null>(null);
  const [draft, setDraft] = useState(filters);
  const [ranges, setRanges] = useState<Texts>(() => macroTexts(filters));
  const [cal, setCal] = useState({ min: text(filters.caloriesRange.min), max: text(filters.caloriesRange.max) });
  const [time, setTime] = useState({ min: text(filters.timeRange.min), max: text(filters.timeRange.max) });
  const [prep, setPrep] = useState(text(filters.prepMax));
  const [error, setError] = useState<string | null>(null);
  const reset = (next: RecipeFilters) => {
    setDraft(next); setRanges(macroTexts(next));
    setCal({ min: text(next.caloriesRange.min), max: text(next.caloriesRange.max) });
    setTime({ min: text(next.timeRange.min), max: text(next.timeRange.max) });
    setPrep(text(next.prepMax)); setError(null);
  };
  const apply = () => {
    const macros = { ...draft.macros };
    for (const key of ["protein", "fat", "carbs"] as const) {
      const min = Number(ranges[key].min.replace(",", ".")); const max = Number(ranges[key].max.replace(",", "."));
      if (ranges[key].min.trim() === "" || ranges[key].max.trim() === "" || !Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max > 100 || min > max) { setError("Диапазон — от 0 до 100 %, минимум не больше максимума."); return; }
      macros[key] = { min, max };
    }
    const caloriesRange = parseNumberRange(cal.min, cal.max, KCAL_LIMIT);
    if (caloriesRange === "INVALID") { setError(`Калории: целые числа от 0 до ${KCAL_LIMIT}, «от» не больше «до».`); return; }
    const timeRange = parseNumberRange(time.min, time.max, MINUTES_LIMIT);
    if (timeRange === "INVALID") { setError("Время: целые минуты, «от» не больше «до»."); return; }
    const prepRange = parseNumberRange("", prep, MINUTES_LIMIT);
    if (prepRange === "INVALID") { setError("Подготовка: целое число минут."); return; }
    onFilters({ ...draft, macros, caloriesRange, timeRange, prepMax: prepRange.max }); setPanel(null);
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
            <View style={[styles.block, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
              <BlockTitle>Калории за порцию</BlockTitle>
              <RangeRow>
                <NumberBox label="Калории, от" placeholder="от" value={cal.min} onChange={(min) => { setCal({ ...cal, min }); setDraft({ ...draft, calories: "ANY" }); }} />
                <Text style={[styles.dash, { color: colors.textMuted }]}>—</Text>
                <NumberBox label="Калории, до" placeholder="до" value={cal.max} onChange={(max) => { setCal({ ...cal, max }); setDraft({ ...draft, calories: "ANY" }); }} />
                <Text style={[styles.unit, { color: colors.textMuted }]}>ккал</Text>
              </RangeRow>
              <ChoiceGrid options={bands} selected={draft.calories} label="Калории за порцию"
                onSelect={(calories) => { setDraft({ ...draft, calories }); setCal({ min: "", max: "" }); }} />
            </View>
            <View style={[styles.block, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
              <BlockTitle>Время приготовления</BlockTitle>
              <RangeRow>
                <NumberBox label="Время, от минут" placeholder="от" value={time.min} onChange={(min) => { setTime({ ...time, min }); setDraft({ ...draft, time: "ANY" }); }} />
                <Text style={[styles.dash, { color: colors.textMuted }]}>—</Text>
                <NumberBox label="Время, до минут" placeholder="до" value={time.max} onChange={(max) => { setTime({ ...time, max }); setDraft({ ...draft, time: "ANY" }); }} />
                <Text style={[styles.unit, { color: colors.textMuted }]}>мин</Text>
              </RangeRow>
              <ChoiceGrid options={times} selected={draft.time} label="Время рецепта"
                onSelect={(next) => { setDraft({ ...draft, time: next }); setTime({ min: "", max: "" }); }} />
              <BlockTitle muted>Подготовка не дольше</BlockTitle>
              <RangeRow>
                <NumberBox label="Подготовка не дольше, минут" placeholder="до" value={prep} onChange={setPrep} />
                <Text style={[styles.unit, { color: colors.textMuted }]}>мин</Text>
              </RangeRow>
            </View>
            <View style={[styles.block, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}>
              <Text style={[styles.label, { color: colors.textPrimary }]}>Доли БЖУ, %</Text>
              {(["protein", "fat", "carbs"] as const).map((key) => <View key={key} style={styles.macro}>
                <View style={styles.blockHead}>
                  <Text style={[styles.macroLabel, { color: colors.textPrimary }]}>{macroNames[key]}</Text>
                  <View style={styles.grow}><NumberBox decimal label={`${macroNames[key]}, от %`} value={ranges[key].min} onChange={(min) => setRanges((current) => ({ ...current, [key]: { ...current[key], min } }))} /></View>
                  <Text style={[styles.dash, { color: colors.textMuted }]}>—</Text>
                  <View style={styles.grow}><NumberBox decimal label={`${macroNames[key]}, до %`} value={ranges[key].max} onChange={(max) => setRanges((current) => ({ ...current, [key]: { ...current[key], max } }))} /></View>
                  <Text style={[styles.unit, { color: colors.textMuted }]}>%</Text>
                </View>
                <PercentRangeSlider label={macroNames[key]}
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
  row: { flexDirection: "row", gap: 5 }, cell: { flex: 1, minWidth: 0 }, grow: { flex: 1, minWidth: 0 },
  body: { gap: 7 }, scroll: { flexGrow: 0, flexShrink: 1 },
  backdrop: { flex: 1, paddingHorizontal: 12, alignItems: "center", justifyContent: "center" },
  scrim: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: scrim },
  sheet: { width: "100%", maxWidth: 420, maxHeight: "100%", padding: 12, borderWidth: 1, borderRadius: 26, gap: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 17, lineHeight: 22 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  block: { borderRadius: 18, borderWidth: 1, padding: 9, gap: 6 }, macro: { gap: 0 },
  blockHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowCentered: { justifyContent: "center" }, choice: { flexDirection: "row", minWidth: 0 },
  rangeRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  macroLabel: { width: 62, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  box: { width: 56, height: 32, borderWidth: 1, borderRadius: 12, paddingVertical: 0, paddingHorizontal: 6, textAlign: "center", fontFamily: fonts.semibold, fontSize: 13 },
  dash: { fontSize: 12 }, unit: { width: 28, fontFamily: fonts.semibold, fontSize: 11 },
});
