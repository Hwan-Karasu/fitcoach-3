import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, BottomSheet, ChoiceGrid } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { ClientRosterFilters } from "../domain/ClientRosterFilters.ts";
import type { RosterSortMode } from "../domain/ClientRosterPort.ts";

/** Группа пилюль ровной сеткой на всю ширину (UI-OWN-064): две колонки, у списков из трёх — три. */
function Choices<Id extends string>({ label, options, selected, onSelect }: Readonly<{
  label: string; options: readonly Readonly<{ id: Id; label: string }>[]; selected: Id; onSelect: (id: Id) => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  return <View style={styles.group}>
    <Text style={[styles.label, { color: colors.textMuted }]}>{label.toUpperCase()}</Text>
    <ChoiceGrid group={label} items={options} selected={[selected]} columns={options.length === 3 ? 3 : 2}
      onPress={(id) => onSelect(id as Id)} />
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
export function ClientRosterFiltersDialog({ visible, filters, sort, countFor, onApply, onSort, onReset, error = null, onClose }: Readonly<{
  visible: boolean;
  filters: ClientRosterFilters;
  sort: RosterSortMode;
  /** Сколько клиентов покажет список при этих фильтрах (с учётом кольца и поиска); null — данные фильтров ещё грузятся. */
  countFor: (filters: ClientRosterFilters) => number | null;
  onApply: (filters: ClientRosterFilters) => void;
  onSort: (mode: RosterSortMode) => void;
  /** Ошибка сохранения сортировки: показывается в самом листе, а не под ним. */
  error?: string | null;
  /** «Сбросить»: фильтры листа и кольцо сводки снимаются вместе. */
  onReset: () => void;
  onClose: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const [draft, setDraft] = useState(filters);
  useEffect(() => { if (visible) setDraft(filters); }, [visible, filters]);
  const shown = countFor(draft);
  return <BottomSheet visible={visible} title="Фильтры" onClose={onClose} footer={<>
    {error === null ? null : <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text>}
    <View style={styles.row}>
      <View style={styles.reset}><AppButton variant="secondary" label="Сбросить" onPress={() => { onReset(); onClose(); }} /></View>
      <View style={styles.show}><AppButton label={shown === null ? "Показать" : `Показать ${shown}`} onPress={() => { onApply(draft); onClose(); }} /></View>
    </View>
  </>}>
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
  </BottomSheet>;
}

const styles = StyleSheet.create({
  group: { gap: 6 },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.8 },
  row: { flexDirection: "row", gap: 8 },
  reset: { flex: 1, minWidth: 0 },
  show: { flex: 2, minWidth: 0 },
  error: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, textAlign: "center" },
});
