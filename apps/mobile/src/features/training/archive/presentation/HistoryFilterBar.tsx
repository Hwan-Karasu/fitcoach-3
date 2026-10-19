import { useMemo } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SelectionChip } from "../../../../shared/ui/components/public.ts";
import type { HistoryFilter, TrainingHistoryEntry } from "./trainingHistory.ts";

/**
 * Фильтр «Все программы / программа / мезоцикл» (§37.3–37.4, §48.8): варианты — из самих записей хронологии,
 * отбор не меняет факты. Общий для архива занятий и истории/прогресса упражнения.
 */
export function HistoryFilterBar({ entries, filter, onChange }: Readonly<{
  entries: readonly TrainingHistoryEntry[];
  filter: HistoryFilter;
  onChange: (filter: HistoryFilter) => void;
}>) {
  const programs = useMemo(() => {
    const seen = new Map<string, TrainingHistoryEntry>();
    for (const entry of entries) if (!seen.has(entry.programId)) seen.set(entry.programId, entry);
    return [...seen.values()];
  }, [entries]);
  const mesocycles = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries) {
      if (entry.programId === filter.programId && entry.mesocycleId !== null) seen.set(entry.mesocycleId, entry.mesocycleTitle ?? "Мезоцикл");
    }
    return [...seen.entries()];
  }, [entries, filter.programId]);
  const selectedProgram = programs.find((entry) => entry.programId === filter.programId);
  return <>
    {programs.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      <SelectionChip group="Программа" label="Все программы" selected={filter.programId === null}
        onPress={() => onChange({ programId: null, mesocycleId: null })} />
      {programs.map((entry) => <SelectionChip key={entry.programId} group="Программа"
        label={entry.planDeleted ? `${entry.programTitle} (план удалён)` : entry.archived ? `${entry.programTitle} (архив)` : entry.programTitle}
        selected={filter.programId === entry.programId}
        onPress={() => onChange({ programId: entry.programId, mesocycleId: null })} />)}
    </ScrollView> : null}
    {selectedProgram?.programKind === "PERIODIZED" && mesocycles.length > 1 ? (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <SelectionChip group="Мезоцикл" label="Все мезоциклы" selected={filter.mesocycleId === null}
          onPress={() => onChange({ ...filter, mesocycleId: null })} />
        {mesocycles.map(([id, title]) => <SelectionChip key={id} group="Мезоцикл" label={title} selected={filter.mesocycleId === id}
          onPress={() => onChange({ ...filter, mesocycleId: id })} />)}
      </ScrollView>
    ) : null}
  </>;
}

const styles = StyleSheet.create({
  chips: { gap: 8, paddingRight: 8 },
});
