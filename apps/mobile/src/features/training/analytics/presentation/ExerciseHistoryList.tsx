import { useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { EmptyState, InlineNotice, LoadingState } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../../shared/ui/theme/style.ts";
import { dateText, plural, useClientHistory, type TrainingHistoryEntry } from "../../archive/public.ts";
import { useExerciseLookup, type ExerciseLookupPort } from "../../plans/public.ts";
import { exerciseActivity } from "./trainingStats.ts";

const normalize = (value: string) => value.toLocaleLowerCase("ru").replace(/ё/g, "е");

/**
 * Режим «Упражнения» в «Истории занятий» (UX-контракт v1.2): упражнения клиента, которые выполнялись, — последнее занятие сверху; поиск по
 * названию без объединения одинаковых названий. Архивные свои упражнения остаются в списке с пометкой «(архив)». Тап — «Упражнение клиента».
 */
export function ExerciseHistoryList({ clientId, history, exercises, query, onOpenExercise }: Readonly<{
  clientId: string;
  history: Readonly<{ list: (clientId: string) => Promise<readonly TrainingHistoryEntry[]>;
    subscribe: (clientId: string, listener: () => void) => () => void }>;
  exercises: ExerciseLookupPort;
  query: string;
  onOpenExercise: (exerciseId: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const lookup = useExerciseLookup(exercises);
  const { entries, failed } = useClientHistory(history, clientId);
  const rows = useMemo(() => exerciseActivity(entries ?? []).map((row) => {
    const info = lookup?.get(row.exerciseId);
    return { ...row, name: `${info?.name ?? "Упражнение"}${info?.archived === true ? " (архив)" : ""}` };
  }), [entries, lookup]);
  const shown = useMemo(() => {
    const needle = normalize(query.trim());
    return needle === "" ? rows : rows.filter((row) => normalize(row.name).includes(needle));
  }, [rows, query]);
  if (failed) return <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить упражнения.</InlineNotice></View>;
  if (entries === null) return <LoadingState label="Собираем упражнения…" />;
  return (
    <FlatList data={shown} keyExtractor={(row) => row.exerciseId} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled"
      ListEmptyComponent={<EmptyState reason={rows.length === 0 ? "no-data" : "no-match"} title={rows.length === 0 ? "Упражнений пока нет" : "Ничего не найдено"}
        body={rows.length === 0 ? "Здесь появятся упражнения, по которым у клиента есть записанные подходы." : "Измените поисковый запрос."} />}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => onOpenExercise(item.exerciseId)}
          accessibilityLabel={`${item.name}: ${item.sessions} ${plural(item.sessions, "занятие", "занятия", "занятий")}, последнее ${dateText(item.lastDate)}. Открыть упражнение`}
          style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
          <View style={styles.grow}>
            <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{item.name}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {`${item.sessions} ${plural(item.sessions, "занятие", "занятия", "занятий")} · последнее ${dateText(item.lastDate)}`}</Text>
          </View>
          <ChevronRight size={20} color={colors.textMuted} strokeWidth={1.8} />
        </Pressable>
      )} />
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 16 },
  grow: { flex: 1 },
  list: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  card: { ...shadow.card, borderRadius: 20, padding: 14, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 64 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
