import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton, AppIconButton, SelectionChip } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { EMPTY_ROSTER_FILTERS, type ClientRosterFilters } from "../domain/ClientRosterFilters.ts";

function Choices<Id extends string>({ label, options, selected, onSelect }: Readonly<{
  label: string; options: readonly Readonly<{ id: Id; label: string }>[]; selected: Id; onSelect: (id: Id) => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  return <View style={[styles.block, { backgroundColor: colors.surfaceRaised }]}>
    <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
    {Array.from({ length: Math.ceil(options.length / 2) }, (_, row) => <View key={row} style={styles.row}>
      {options.slice(row * 2, row * 2 + 2).map((option) => <SelectionChip key={option.id} compact fill group={label}
        label={option.label} selected={selected === option.id} onPress={() => onSelect(option.id)} />)}
    </View>)}
  </View>;
}

export function ClientRosterFiltersDialog({ visible, filters, onApply, onClose }: Readonly<{
  visible: boolean; filters: ClientRosterFilters; onApply: (filters: ClientRosterFilters) => void; onClose: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(filters);
  useEffect(() => { if (visible) setDraft(filters); }, [visible, filters]);
  const apply = (next: ClientRosterFilters) => { onApply(next); onClose(); };
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <View style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <Pressable accessible={false} importantForAccessibility="no" style={styles.scrim} onPress={onClose} />
      <View accessibilityViewIsModal style={[styles.dialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Фильтры клиентов</Text>
          <AppIconButton label="Закрыть фильтры клиентов" icon={<X size={20} color={colors.iconPrimary} />} onPress={onClose} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.body}>
          <Choices<ClientRosterFilters["sex"]> label="Пол" selected={draft.sex}
            options={[{ id: "ALL", label: "Все" }, { id: "MALE", label: "Мужчины" }, { id: "FEMALE", label: "Женщины" }, { id: "UNSPECIFIED", label: "Не указан" }]}
            onSelect={(sex) => setDraft({ ...draft, sex })} />
          <Choices<ClientRosterFilters["health"]> label="Ограничения здоровья" selected={draft.health}
            options={[{ id: "ALL", label: "Все" }, { id: "RESTRICTED", label: "Есть ограничения" }, { id: "UNMARKED", label: "Без отметки" }]}
            onSelect={(health) => setDraft({ ...draft, health })} />
          <Choices<ClientRosterFilters["credit"]> label="Абонемент" selected={draft.credit}
            options={[{ id: "ALL", label: "Все" }, { id: "AVAILABLE", label: "Есть занятия" }, { id: "EMPTY", label: "Нет доступных занятий" },
              { id: "NO_PACK", label: "Нет пакета" }, { id: "NOT_TRACKED", label: "Без учёта" }]}
            onSelect={(credit) => setDraft({ ...draft, credit })} />
        </ScrollView>
        <View style={styles.row}>
          <View style={styles.cell}><AppButton compact size="small" variant="secondary" label="Сбросить" onPress={() => apply(EMPTY_ROSTER_FILTERS)} /></View>
          <View style={styles.cell}><AppButton compact size="small" label="Применить" onPress={() => apply(draft)} /></View>
        </View>
      </View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  overlay: { flex: 1, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  scrim: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  dialog: { width: "100%", maxWidth: 420, maxHeight: "100%", borderWidth: 1, borderRadius: 20, padding: 12, gap: 10 },
  header: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  label: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: 10 },
  block: { padding: 10, borderRadius: 14, gap: 8 },
  row: { flexDirection: "row", gap: 6 },
  cell: { flex: 1, minWidth: 0 },
});
