import { useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { DropdownMenu, FilterPill } from "../../../../shared/ui/components/public.ts";
import { ALL_OPTION, mesocycleOptions, programOptions, type HistoryFilter, type TrainingHistoryEntry } from "./trainingHistory.ts";

/** Список длиннее этого получает строку поиска. */
const SEARCH_FROM = 6;

/**
 * Фильтр «программа → мезоцикл» (§37.3–37.4, §48.8): пилюли с выпадающим списком, который виртуализирован и ищется, —
 * не растёт вбок с числом программ. Мезоцикл — только у Расширенной с несколькими мезоциклами. Варианты берутся из самих
 * записей хронологии, отбор не меняет факты. `trailing` — соседние пилюли того же ряда (период, отчёт); ряд переносится.
 */
export function HistoryFilterBar({ entries, filter, onChange, trailing }: Readonly<{
  entries: readonly TrainingHistoryEntry[];
  filter: HistoryFilter;
  onChange: (filter: HistoryFilter) => void;
  trailing?: ReactNode;
}>) {
  const programs = useMemo(() => programOptions(entries), [entries]);
  const mesocycles = useMemo(() => filter.programId === null ? [] : mesocycleOptions(entries, filter.programId), [entries, filter.programId]);
  const [open, setOpen] = useState<"program" | "mesocycle" | null>(null);
  const programAnchor = useRef<View>(null);
  const mesocycleAnchor = useRef<View>(null);
  const programKind = entries.find((entry) => entry.programId === filter.programId)?.programKind;
  const showPrograms = programs.length > 2;
  const showMesocycles = programKind === "PERIODIZED" && mesocycles.length > 2;
  const programLabel = programs.find((option) => option.value === (filter.programId ?? ALL_OPTION))?.label ?? "Все программы";
  const mesocycleLabel = mesocycles.find((option) => option.value === (filter.mesocycleId ?? ALL_OPTION))?.label ?? "Все мезоциклы";
  if (!showPrograms && trailing === undefined) return null;
  return (
    <View style={styles.row}>
      {showPrograms ? <FilterPill grow menu expanded={open === "program"} anchorRef={programAnchor} label={programLabel}
        selected={filter.programId !== null} accessibilityLabel={`Программа: ${programLabel}`} onPress={() => setOpen("program")} /> : null}
      {showMesocycles ? <FilterPill grow menu expanded={open === "mesocycle"} anchorRef={mesocycleAnchor} label={mesocycleLabel}
        selected={filter.mesocycleId !== null} accessibilityLabel={`Мезоцикл: ${mesocycleLabel}`} onPress={() => setOpen("mesocycle")} /> : null}
      {trailing}
      <DropdownMenu visible={open === "program"} anchor={programAnchor} title="Программа" options={programs} selected={filter.programId ?? ALL_OPTION}
        searchable={programs.length > SEARCH_FROM} onClose={() => setOpen(null)}
        onSelect={(value) => onChange({ programId: value === ALL_OPTION ? null : value, mesocycleId: null })} />
      <DropdownMenu visible={open === "mesocycle"} anchor={mesocycleAnchor} title="Мезоцикл" options={mesocycles} selected={filter.mesocycleId ?? ALL_OPTION}
        searchable={mesocycles.length > SEARCH_FROM} onClose={() => setOpen(null)}
        onSelect={(value) => onChange({ ...filter, mesocycleId: value === ALL_OPTION ? null : value })} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
});
