import { useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { DropdownMenu, FilterPill } from "../../../../shared/ui/components/public.ts";
import { workoutOptions } from "./historyGroups.ts";
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
  const workouts = useMemo(() => filter.programId === null ? [] : workoutOptions(entries, filter.programId, filter.mesocycleId),
    [entries, filter.programId, filter.mesocycleId]);
  const [open, setOpen] = useState<"program" | "mesocycle" | "workout" | null>(null);
  const programAnchor = useRef<View>(null);
  const mesocycleAnchor = useRef<View>(null);
  const workoutAnchor = useRef<View>(null);
  const programKind = entries.find((entry) => entry.programId === filter.programId)?.programKind;
  const showPrograms = programs.length > 2;
  const showMesocycles = programKind === "PERIODIZED" && mesocycles.length > 2;
  const showWorkouts = filter.programId !== null && workouts.length > 2;
  const programLabel = programs.find((option) => option.value === (filter.programId ?? ALL_OPTION))?.label ?? "Все программы";
  const mesocycleLabel = mesocycles.find((option) => option.value === (filter.mesocycleId ?? ALL_OPTION))?.label ?? "Все мезоциклы";
  const workoutLabel = workouts.find((option) => option.value === (filter.workoutKey ?? ALL_OPTION))?.label ?? "Все тренировки";
  if (!showPrograms && trailing === undefined) return null;
  // Программа и мезоцикл — свой ряд, соседние пилюли (период, отчёт) — следующий: в одном ряду на три пилюли
  // «Все программы» не помещалось и обрезалось до «Все прог…».
  return (
    <View style={styles.column}>
      {showPrograms ? <View style={styles.row}>
        <FilterPill grow menu expanded={open === "program"} anchorRef={programAnchor} label={programLabel}
          selected={filter.programId !== null} accessibilityLabel={`Программа: ${programLabel}`} onPress={() => setOpen("program")} />
        {showMesocycles ? <FilterPill grow menu expanded={open === "mesocycle"} anchorRef={mesocycleAnchor} label={mesocycleLabel}
          selected={filter.mesocycleId !== null} accessibilityLabel={`Мезоцикл: ${mesocycleLabel}`} onPress={() => setOpen("mesocycle")} /> : null}
        {showWorkouts ? <FilterPill grow menu expanded={open === "workout"} anchorRef={workoutAnchor} label={workoutLabel}
          selected={filter.workoutKey !== null} accessibilityLabel={`Тренировка: ${workoutLabel}`} onPress={() => setOpen("workout")} /> : null}
      </View> : null}
      {trailing !== undefined ? <View style={styles.row}>{trailing}</View> : null}
      <DropdownMenu visible={open === "program"} anchor={programAnchor} title="Программа" options={programs} selected={filter.programId ?? ALL_OPTION}
        searchable={programs.length > SEARCH_FROM} onClose={() => setOpen(null)}
        onSelect={(value) => onChange({ programId: value === ALL_OPTION ? null : value, mesocycleId: null, workoutKey: null })} />
      <DropdownMenu visible={open === "mesocycle"} anchor={mesocycleAnchor} title="Мезоцикл" options={mesocycles} selected={filter.mesocycleId ?? ALL_OPTION}
        searchable={mesocycles.length > SEARCH_FROM} onClose={() => setOpen(null)}
        onSelect={(value) => onChange({ ...filter, mesocycleId: value === ALL_OPTION ? null : value, workoutKey: null })} />
      <DropdownMenu visible={open === "workout"} anchor={workoutAnchor} title="Тренировка" options={workouts} selected={filter.workoutKey ?? ALL_OPTION}
        searchable={workouts.length > SEARCH_FROM} onClose={() => setOpen(null)}
        onSelect={(value) => onChange({ ...filter, workoutKey: value === ALL_OPTION ? null : value })} />
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: 8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
});
