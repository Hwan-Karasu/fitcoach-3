import { StyleSheet, Text, View } from "react-native";
import { SelectionChip } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";

/**
 * Выбор участников Расширенной программы (§48.1, §48.6.2): открывший клиент выбран всегда, остальные —
 * по нажатию. Невыбранные участники не изменяются.
 */
export function ParticipantChips({ clientId, memberIds, names, selected, onChange, note }: Readonly<{
  clientId: string;
  memberIds: readonly string[];
  names: ReadonlyMap<string, string>;
  selected: readonly string[];
  onChange: (next: readonly string[]) => void;
  note: string;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  if (memberIds.length < 2) return null;
  return (
    <View style={styles.block}>
      <Text style={[styles.group, { color: colors.textPrimary }]}>Участники</Text>
      <Text style={[styles.note, { color: colors.textSecondary }]}>{note}</Text>
      <View style={styles.chips}>
        {memberIds.map((id) => (
          <SelectionChip key={id} group="Участники" label={names.get(id) ?? "Клиент"} selected={selected.includes(id)}
            disabled={id === clientId} disabledReason="Открытый клиент выбран всегда"
            onPress={() => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id])} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6 },
  group: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
