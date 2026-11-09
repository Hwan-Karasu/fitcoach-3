import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton, SelectionChip } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { ClientRosterFilters } from "../domain/ClientRosterFilters.ts";
import type { RosterSortMode } from "../domain/ClientRosterPort.ts";

/** Группа пилюль ровной сеткой на всю ширину (UI-OWN-064): две колонки, у коротких списков из трёх — три. */
function Choices<Id extends string>({ label, options, selected, onSelect }: Readonly<{
  label: string; options: readonly Readonly<{ id: Id; label: string }>[]; selected: Id; onSelect: (id: Id) => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const columns = options.length === 3 ? 3 : 2;
  return <View style={styles.group}>
    <Text style={[styles.label, { color: colors.textMuted }]}>{label.toUpperCase()}</Text>
    {Array.from({ length: Math.ceil(options.length / columns) }, (_, row) => <View key={row} style={styles.row}>
      {options.slice(row * columns, row * columns + columns).map((option) => <SelectionChip key={option.id} fill group={label}
        label={option.label} selected={selected === option.id} onPress={() => onSelect(option.id)} />)}
    </View>)}
  </View>;
}

const sortOptions: readonly Readonly<{ id: RosterSortMode; label: string }>[] = [
  { id: "NAME", label: "Имя А–Я" },
  { id: "RECENT", label: "Недавние" },
];

/**
 * Фильтры клиентов нижним листом (UIX-02, UI-OWN-064): «Пол», «Ограничения здоровья», «Абонемент», «Сортировка».
 * Сортировка применяется сразу, фильтры — по «Показать N» (N считает `countFor` по выбранному в листе).
 */
export function ClientRosterFiltersDialog({ visible, filters, sort, countFor, onApply, onSort, onReset, onClose }: Readonly<{
  visible: boolean;
  filters: ClientRosterFilters;
  sort: RosterSortMode;
  /** Сколько клиентов покажет список при этих фильтрах (с учётом кольца и поиска); null — данные фильтров ещё грузятся. */
  countFor: (filters: ClientRosterFilters) => number | null;
  onApply: (filters: ClientRosterFilters) => void;
  onSort: (mode: RosterSortMode) => void;
  /** «Сбросить»: фильтры листа и кольцо сводки снимаются вместе. */
  onReset: () => void;
  onClose: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(filters);
  useEffect(() => { if (visible) setDraft(filters); }, [visible, filters]);
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <View style={styles.overlay}>
      <Pressable accessible={false} importantForAccessibility="no" style={styles.scrim} onPress={onClose} />
      <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.canvas, paddingBottom: insets.bottom + 12 }]}>
        <View style={[styles.handle, { backgroundColor: colors.border }]} />
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Фильтры</Text>
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
          <Choices<RosterSortMode> label="Сортировка" selected={sort} options={sortOptions} onSelect={onSort} />
        </ScrollView>
        <View style={styles.row}>
          <View style={styles.reset}><AppButton variant="secondary" label="Сбросить" onPress={() => { onReset(); onClose(); }} /></View>
          <View style={styles.show}><AppButton label={(() => { const shown = countFor(draft); return shown === null ? "Показать" : `Показать ${shown}`; })()} onPress={() => { onApply(draft); onClose(); }} /></View>
        </View>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, textAlign: "center" },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: 14, paddingBottom: 4 },
  group: { gap: 6 },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.8 },
  row: { flexDirection: "row", gap: 8 },
  reset: { flex: 1, minWidth: 0 },
  show: { flex: 2, minWidth: 0 },
});
