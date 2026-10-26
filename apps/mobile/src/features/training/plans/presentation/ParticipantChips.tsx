import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Plus, X } from "lucide-react-native";
import { DropdownMenu } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";

/**
 * Выбор участников Расширенной программы (§48.1, §48.6.2): выбранные — короткие снимаемые метки, добавление —
 * поиском в выпадающем списке (решение владельца 2026-10-18: при 20+ клиентах пилюли всех не помещаются); пилюли — под
 * поиском, «×» в пилюле убирает (2026-10-19).
 * Открывший клиент выбран всегда. Невыбранные участники не изменяются.
 */
export function ParticipantChips({ clientId, memberIds, names, selected, onChange, note, onConfigure, details }: Readonly<{
  clientId: string;
  memberIds: readonly string[];
  names: ReadonlyMap<string, string>;
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
  note: string;
  onConfigure?: (id: string) => void;
  details?: ReadonlyMap<string, string>;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const anchor = useRef<View>(null);
  const [open, setOpen] = useState(false);
  if (memberIds.length < 2) return null;
  const nameOf = (id: string) => names.get(id) ?? "Клиент";
  const available = memberIds.filter((id) => !selected.includes(id));
  return (
    <View style={styles.block}>
      <Text style={[styles.group, { color: colors.textPrimary }]}>Участники</Text>
      <Text style={[styles.note, { color: colors.textSecondary }]}>{note}</Text>
      {available.length > 0 ? (
        <View ref={anchor} collapsable={false}>
          <Pressable accessibilityRole="button" accessibilityLabel="Добавить клиента к программе" onPress={() => setOpen(true)}
            style={({ pressed }) => [styles.add, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : colors.input }]}>
            <Plus size={16} color={colors.accentInk} strokeWidth={2.2} />
            <Text style={[styles.addText, { color: colors.accentInk }]}>Добавить клиента к программе</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.chips}>
        {selected.map((id) => {
          const fixed = id === clientId;
          return (
            <View key={id}
              style={[styles.chip, { borderColor: colors.accentInk, backgroundColor: colors.surfaceRaised }]}>
              <Pressable accessibilityRole="button" disabled={fixed || onConfigure === undefined}
                accessibilityLabel={fixed ? `${nameOf(id)}, выбран всегда` : `Выбрать цикл: ${nameOf(id)}`}
                onPress={() => onConfigure?.(id)} style={{ flexShrink: 1, paddingVertical: 6 }}>
                <Text numberOfLines={1} style={[styles.chipText, { color: colors.accentInk }]}>{nameOf(id)}</Text>
                {!fixed && onConfigure !== undefined ? <Text style={[styles.note, { color: colors.textSecondary }]}>
                  {details?.get(id) ?? "Нажмите, чтобы прикрепить существующий цикл"}
                </Text> : null}
              </Pressable>
              {fixed ? null : <Pressable accessibilityRole="button" accessibilityLabel={`Убрать участника: ${nameOf(id)}`}
                onPress={() => onChange(selected.filter((item) => item !== id))} hitSlop={6} style={{ padding: 6 }}>
                <X size={16} color={colors.accentInk} strokeWidth={2.2} />
              </Pressable>}
            </View>
          );
        })}
      </View>
      <DropdownMenu searchable visible={open} anchor={anchor} title="Добавить клиента" selected=""
        options={available.map((id) => ({ value: id, label: nameOf(id) }))}
        onClose={() => setOpen(false)} onSelect={(id) => { onChange([...selected, id]); setOpen(false); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6 },
  group: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 36, borderWidth: 1, borderRadius: 15, paddingHorizontal: 10,
    maxWidth: "100%" },
  chipText: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
  add: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, minHeight: 42, borderWidth: 1, borderRadius: 10 },
  addText: { fontFamily: fonts.semibold, fontSize: 13 },
});
