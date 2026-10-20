import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { EmptyState, InlineNotice, LoadingState, SearchField, SegmentedControl } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { programsWithHistory, type ProgramHistorySummary } from "./historyGroups.ts";
import { plural } from "../../../../shared/format/clockText.ts";
import type { HistoryMode } from "./historyTypes.ts";
import { historyViewOf } from "./historyViewState.ts";
import type { TrainingHistoryEntry } from "./trainingHistory.ts";
import { useClientHistory } from "./useClientHistory.ts";

function ProgramCard({ program, onOpen }: Readonly<{ program: ProgramHistorySummary; onOpen: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const note = program.planDeleted ? "Исходный план удалён" : program.archived ? "Архивная" : null;
  const counts = `Проведено ${program.completed} · Записей ${program.records} · Рабочих подходов ${program.workingSets}`;
  const mesocycles = program.mesocycles > 0
    ? `${program.mesocycles} ${plural(program.mesocycles, "мезоцикл", "мезоцикла", "мезоциклов")} с историей` : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${program.title}${note === null ? "" : `, ${note}`}. ${counts}. Открыть историю программы`}
      onPress={onOpen} style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
      <View style={styles.cardHead}>
        <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{program.title}</Text>
        <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} />
      </View>
      {note !== null ? <Text style={[styles.note, { color: colors.accentInk, backgroundColor: colors.accentSoft }]}>{note}</Text> : null}
      {mesocycles !== null ? <Text style={[styles.meta, { color: colors.textSecondary }]}>{mesocycles}</Text> : null}
      <Text style={[styles.meta, { color: colors.textSecondary }]}>{counts}</Text>
    </Pressable>
  );
}

/**
 * «История занятий» клиента (UX-контракт v1.2): два режима — «Тренировки» (список программ с историей; программа открывает свой экран с лентой
 * мезоциклов и тренировками) и «Упражнения» (список упражнений клиента — его подставляет навигация). Данные — единая хронология (§48.85).
 * Режим и поиск сохраняются, пока открыта карточка клиента. Экран только читает.
 */
export function TrainingArchiveScreen({ clientId, history, onOpenProgram, renderExercises }: Readonly<{
  clientId: string;
  history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
    subscribe: (clientId: string, listener: () => void) => () => void }>;
  onOpenProgram: (programId: string) => void;
  /** Список упражнений клиента (аналитика упражнений — другой модуль); получает поисковую строку. */
  renderExercises: (query: string) => ReactNode;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const view = historyViewOf(clientId);
  const [mode, setMode] = useState<HistoryMode>(view.mode);
  const [query, setQuery] = useState(view.query);
  const { entries, failed } = useClientHistory(history, clientId);
  useEffect(() => { view.mode = mode; view.query = query; }, [view, mode, query]);

  const programs = useMemo(() => programsWithHistory(entries ?? []), [entries]);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return needle === "" ? programs : programs.filter((program) => program.title.toLocaleLowerCase("ru").includes(needle));
  }, [programs, query]);

  const header = (
    <View style={styles.header}>
      <SegmentedControl items={[{ id: "workouts", label: "Тренировки" }, { id: "exercises", label: "Упражнения" }]} selectedId={mode} onSelect={setMode} />
      <SearchField query={query} onChangeQuery={setQuery} accessibilityLabel={mode === "workouts" ? "Поиск программы" : "Поиск упражнения"}
        placeholder={mode === "workouts" ? "Поиск программы" : "Поиск упражнения"} />
    </View>
  );
  if (mode === "exercises") return <View style={[styles.screen, { backgroundColor: colors.canvas }]}>{header}{renderExercises(query)}</View>;
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {header}
      {failed ? <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить историю занятий.</InlineNotice></View> : null}
      {entries === null && !failed ? <LoadingState label="Собираем историю занятий…" /> : null}
      {entries !== null ? <FlatList data={shown as ProgramHistorySummary[]} keyExtractor={(program) => program.programId}
        contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<EmptyState reason={programs.length === 0 ? "no-data" : "no-match"}
          title={programs.length === 0 ? "История занятий пока пуста" : "Ничего не найдено"}
          body={programs.length === 0 ? "Здесь появятся программы, в которых есть тренировки с подходами или исходом." : "Измените поисковый запрос."} />}
        renderItem={({ item }) => <ProgramCard program={item} onOpen={() => onOpenProgram(item.programId)} />} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { paddingHorizontal: 16 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 8, gap: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  note: { alignSelf: "flex-start", fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 4, overflow: "hidden" },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
