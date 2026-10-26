import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { AppButton, DropdownMenu, TextField } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { legacyFields, type ImportTable, type LegacyMapping, type WorkbookReviewEntry } from "../../features/import/public.ts";

export function excelColumnName(index: number): string {
  let result = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}
const hints: Partial<Record<keyof LegacyMapping, string>> = {
  week: "Номер недели программы", workout: "Название тренировки", exercise: "Название упражнения из вашей таблицы",
  sets: "Количество подходов в строке; если один подход на строку, можно не выбирать",
  reps: "Сколько повторений запланировано", load: "Плановый вес в килограммах",
  actualReps: "Сколько повторений выполнено", actualLoad: "Выполненный вес в килограммах", date: "Дата выполненной тренировки",
};

export function WorkbookColumnSettings({ table, entry, onChange, onApply, busy }: Readonly<{
  table: ImportTable; entry: WorkbookReviewEntry; busy: boolean;
  onChange: (patch: Partial<WorkbookReviewEntry>) => void; onApply: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const anchors = useRef(new Map<string, View | null>());
  const [field, setField] = useState<keyof LegacyMapping | null>(null);
  const [headerText, setHeaderText] = useState(String(entry.header + 1));
  const source = table.matrixSource ?? table;
  const headings = source.rows[entry.header] ?? [];
  const width = Math.max(0, ...source.rows.slice(0, 30).map((row) => row.length));
  const columnLabel = (column: number) => `${excelColumnName(column)} — ${String(headings[column] ?? "").trim() || "Без заголовка"}`;
  const headerValid = /^\d+$/u.test(headerText) && Number(headerText) >= 1 && Number(headerText) <= source.rows.length;
  const Icon = entry.settingsOpen ? ChevronUp : ChevronDown;
  return <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: entry.settingsOpen }}
      onPress={() => onChange({ settingsOpen: !entry.settingsOpen })} style={styles.toggle}>
      <Text style={[styles.heading, { color: colors.accentInk }]}>Настроить столбцы</Text><Icon size={18} color={colors.accentInk} />
    </Pressable>
    {entry.settingsOpen && <>
      <Text style={[styles.body, { color: colors.textSecondary }]}>Укажите, из каких столбцов Excel брать данные. Обычно они определяются автоматически.</Text>
      {table.matrixSource ? <Text style={[styles.body, { color: colors.textSecondary }]}>Это матрица приложения. Недели, тренировки и столбцы уже распознаны. Ниже показан исходный лист; вручную сопоставлять его не нужно.</Text> : <>
        <TextField label="Строка с заголовками" keyboardType="number-pad" value={headerText}
          onChangeText={(value) => {
            if (!/^\d*$/u.test(value)) return;
            setHeaderText(value); onChange({ settingsDirty: true, ...(Number(value) >= 1 && Number(value) <= source.rows.length ? { header: Number(value) - 1 } : {}) });
          }} />
        <Text style={[styles.body, { color: colors.textSecondary }]}>Номер строки Excel с названиями столбцов, а не с первым упражнением.</Text>
        <View style={styles.grid}>{(Object.entries(legacyFields) as [keyof LegacyMapping, string][]).map(([key, title]) => <View key={key}
          style={styles.cell} ref={(node) => { anchors.current.set(key, node); }} collapsable={false}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>{title}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Столбец: ${title}`} disabled={busy} onPress={() => setField(key)}
            style={[styles.select, { borderColor: colors.border, backgroundColor: colors.input }]}>
            <Text style={[styles.selected, { color: colors.textPrimary }]}>{entry.columns[key] === undefined ? "Не использовать" : columnLabel(entry.columns[key]!)}</Text>
            <ChevronDown size={16} color={colors.accentInk} />
          </Pressable>
          {!!hints[key] && <Text style={[styles.hint, { color: colors.textSecondary }]}>{hints[key]}</Text>}
        </View>)}</View>
        <AppButton compact label="Применить настройки" disabled={busy || !headerValid} onPress={onApply} />
        {!headerValid && <Text style={[styles.body, { color: colors.textSecondary }]}>Введите существующий номер строки Excel.</Text>}
      </>}
      <Text style={[styles.label, { color: colors.textPrimary }]}>Фрагмент исходного листа «{source.name}»</Text>
      {source.rows.slice(table.matrixSource ? 0 : entry.header, (table.matrixSource ? 0 : entry.header) + 4).map((row, index) => <Text key={index}
        style={[styles.hint, { color: colors.textSecondary }]} numberOfLines={3}>
        {`${(table.matrixSource ? 0 : entry.header) + index + 1}: ${row.slice(0, 6).map((cell, column) => `${excelColumnName(column)}: ${String(cell ?? "").trim() || "—"}`).join(" · ")}`}
      </Text>)}
    </>}
    <DropdownMenu searchable visible={field !== null} anchor={{ current: field === null ? null : anchors.current.get(field) ?? null }}
      title={field === null ? "Столбец Excel" : legacyFields[field]} selected={field === null || entry.columns[field] === undefined ? "none" : String(entry.columns[field])}
      options={[{ value: "none", label: "Не использовать" }, ...Array.from({ length: width }, (_, column) => ({ value: String(column), label: columnLabel(column) }))]}
      onClose={() => setField(null)} onSelect={(value) => {
        if (field !== null) onChange({ columns: { ...entry.columns, [field]: value === "none" ? undefined : Number(value) }, settingsDirty: true });
        setField(null);
      }} />
  </View>;
}
const styles = StyleSheet.create({ card: { padding: 12, borderWidth: 1, borderRadius: 12, gap: 10 }, toggle: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 44 },
  heading: { fontFamily: fonts.semibold, fontSize: 15 }, body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 }, cell: { width: "48%", flexGrow: 1, gap: 6 },
  label: { fontFamily: fonts.medium, fontSize: 13 }, hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  select: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: 10, padding: 10 },
  selected: { flex: 1, fontFamily: fonts.medium, fontSize: 13 } });
