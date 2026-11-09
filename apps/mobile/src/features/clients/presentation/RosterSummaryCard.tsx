import { Pressable, StyleSheet, Text, View } from "react-native";
import { SegmentedRing } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { RosterRing, RosterSummary } from "../domain/ClientRosterFilters.ts";

const cells: readonly Readonly<{ id: RosterRing; caption: string; label: string }>[] = [
  { id: "TODAY", caption: "Занятий\nсегодня", label: "Занятий сегодня" },
  { id: "WEEK", caption: "Занятий\nна неделе", label: "Занятий на неделе" },
  { id: "ENDING", caption: "Кончается\nабонемент", label: "Кончается абонемент" },
];

/**
 * Сводка дня на «Клиентах» (UIX-02, UI-OWN-061): одна карточка с тремя кольцами. Нажатие включает фильтр списка,
 * повторное снимает. Число — как в `summarizeRoster`; дуга — доля клиентов, которые попадают под кольцо.
 * `summary: null` — данные ещё не пришли: прочерк, а не ноль.
 */
export function RosterSummaryCard({ summary, activeCount, ring, onToggle }: Readonly<{
  summary: RosterSummary | null;
  activeCount: number;
  ring: RosterRing | null;
  onToggle: (ring: RosterRing) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const numbers = summary === null ? null : { TODAY: summary.today, WEEK: summary.week, ENDING: summary.ending } as const;
  const clients = summary === null ? null : { TODAY: summary.todayClients, WEEK: summary.weekClients, ENDING: summary.ending } as const;
  return (
    <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
      {cells.map((cell) => {
        const selected = ring === cell.id;
        const value = numbers?.[cell.id] ?? null;
        const fraction = clients === null || activeCount === 0 ? null : clients[cell.id] / activeCount;
        return (
          <Pressable key={cell.id} accessibilityRole="button" accessibilityState={{ selected }}
            accessibilityLabel={`${cell.label}: ${value ?? "нет данных"}`}
            accessibilityHint={selected ? "Снять фильтр списка" : "Показать этих клиентов"}
            onPress={() => onToggle(cell.id)}
            style={({ pressed }) => [styles.cell, { backgroundColor: selected ? colors.accentSoft : "transparent", opacity: pressed ? 0.85 : 1 }]}>
            <SegmentedRing size={44} stroke={5} fraction={fraction}
              accessibilityLabel={`${cell.label}: ${value ?? "нет данных"}`}>
              <Text style={[styles.value, { color: colors.textPrimary }]}>{value === null ? "—" : String(value)}</Text>
            </SegmentedRing>
            <Text style={[styles.caption, { color: selected ? colors.onAccentSoft : colors.textSecondary }]}>{cell.caption}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: "row", gap: 4, borderRadius: 26, padding: 6 },
  cell: { flex: 1, minWidth: 0, minHeight: 88, borderRadius: 20, alignItems: "center", justifyContent: "center", gap: 4, paddingVertical: 6 },
  value: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 20 },
  caption: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 14, textAlign: "center" },
});
