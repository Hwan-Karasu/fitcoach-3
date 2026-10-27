import { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { displayNameOf, type CatalogEntry } from "../../features/exercises/public.ts";
import type { ExerciseImportMatch } from "../../features/import/public.ts";

export function RememberedImportMatchesDialog({ matches, catalog, onApply, onDecline }: Readonly<{
  matches: readonly ExerciseImportMatch[] | null; catalog: readonly CatalogEntry[];
  onApply: (selected: readonly ExerciseImportMatch[]) => void; onDecline: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { setSelected(new Set(matches?.filter((match) => match.available !== false).map((match) => match.sourceName) ?? [])); }, [matches]);
  return matches === null ? null : <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.textPrimary }]}>Использовать прошлые сопоставления?</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>Эти названия уже встречались в других импортах. Выберите пары для всей текущей книги. Сохранённые программы не изменятся.</Text>
        {(matches ?? []).map((match) => {
          const target = catalog.find((entry) => entry.definition.id === match.targetId);
          const checked = selected.has(match.sourceName); const unavailable = match.available === false;
          return <Pressable key={match.sourceName} accessibilityRole="checkbox" accessibilityState={{ checked, disabled: unavailable }} disabled={unavailable}
            accessibilityLabel={`${match.sourceName}: ${target ? displayNameOf(target) : "Упражнение недоступно"}`}
            onPress={() => setSelected((current) => { const next = new Set(current); if (next.has(match.sourceName)) next.delete(match.sourceName); else next.add(match.sourceName); return next; })}
            style={[styles.card, { borderColor: checked ? colors.accentInk : colors.border, backgroundColor: colors.surface }]}>
            <Text style={[styles.body, { color: colors.accentInk }]}>{checked ? "☑" : "☐"}</Text>
            <View style={{ flex: 1, gap: 4 }}><Text style={[styles.name, { color: colors.textPrimary }]}>{match.sourceName}</Text>
              <Text style={[styles.body, { color: colors.textSecondary }]}>→ {unavailable ? "Упражнение недоступно — выберите замену в каталоге" : target ? displayNameOf(target) : "Выберите замену в каталоге"}</Text></View>
          </Pressable>;
        })}
      </ScrollView>
      <View style={styles.actions}>
        <AppButton label="Применить выбранные" onPress={() => onApply((matches ?? []).filter((match) => match.available !== false && selected.has(match.sourceName)))} />
        <AppButton variant="secondary" label="Не использовать" onPress={onDecline} />
      </View>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, content: { padding: 16, gap: 12 }, heading: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 }, name: { fontFamily: fonts.semibold, fontSize: 15 },
  card: { padding: 12, borderWidth: 1, borderRadius: 12, flexDirection: "row", gap: 12, alignItems: "center" }, actions: { padding: 16, gap: 8 } });
