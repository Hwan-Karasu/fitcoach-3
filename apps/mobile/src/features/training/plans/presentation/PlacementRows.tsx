import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronDown, FolderInput } from "lucide-react-native";
import { DropdownMenu } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ClientPlacementOptions, PlacementTarget } from "../domain/Placement.ts";

const keyOf = (target: PlacementTarget) => target.kind === "program" ? `program:${target.programId}` : target.kind;
const targetOf = (key: string): PlacementTarget => key.startsWith("program:") ? { kind: "program", programId: key.slice(8) }
  : key === "new" ? { kind: "new" } : { kind: "join" };

/**
 * Куда ляжет мезоцикл у добавленных клиентов (UI-OWN-044, решение владельца): предупреждение с предложенной
 * программой (как в 2.0) и выбор — другая его Расширенная, эта программа или новая.
 */
export function PlacementRows({ options, values, names, hostTitle, onChange }: Readonly<{
  options: readonly ClientPlacementOptions[];
  values: ReadonlyMap<string, PlacementTarget>;
  names: ReadonlyMap<string, string>;
  /** Название этой программы (при создании — вводимое). */
  hostTitle: string;
  onChange: (clientId: string, target: PlacementTarget) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const anchors = useRef(new Map<string, View | null>());
  const [open, setOpen] = useState<string | null>(null);
  if (options.length === 0) return null;
  const host = hostTitle.trim() || "эта программа";
  const describe = (item: ClientPlacementOptions, name: string) => {
    const target = values.get(item.clientId) ?? item.preferred;
    if (target.kind === "program") {
      const program = item.programs.find((candidate) => candidate.id === target.programId);
      return `У ${name} есть «${program?.title ?? "программа"}» — мезоцикл добавится туда.`;
    }
    return target.kind === "new" ? `${name}: новая программа «${host}».` : `${name}: участие в «${host}».`;
  };
  const current = options.find((item) => item.clientId === open);
  return (
    <View style={styles.block}>
      {options.map((item) => {
        const name = names.get(item.clientId) ?? "Клиент";
        return (
          <View key={item.clientId} ref={(node) => { anchors.current.set(item.clientId, node); }} collapsable={false}
            style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
            <FolderInput size={16} color={colors.accentInk} strokeWidth={2} />
            <Text style={[styles.text, { color: colors.textPrimary }]}>{describe(item, name)}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Куда добавить мезоцикл: ${name}. Изменить`} hitSlop={10}
              onPress={() => setOpen(item.clientId)} style={styles.change}>
              <Text style={[styles.changeText, { color: colors.accentInk }]}>Изменить</Text>
              <ChevronDown size={14} color={colors.accentInk} strokeWidth={2} />
            </Pressable>
          </View>
        );
      })}
      <DropdownMenu visible={current !== undefined} anchor={{ current: open === null ? null : anchors.current.get(open) ?? null }}
        title="Куда добавить мезоцикл" selected={current === undefined ? "" : keyOf(values.get(current.clientId) ?? current.preferred)}
        options={current === undefined ? [] : [
          ...current.programs.map((program) => ({ value: `program:${program.id}`, label: program.current ? `${program.title} (текущая)` : program.title })),
          { value: "new", label: "Новая программа" },
        ]}
        onClose={() => setOpen(null)}
        onSelect={(value) => { if (current !== undefined) onChange(current.clientId, targetOf(value)); setOpen(null); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  text: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  change: { flexDirection: "row", alignItems: "center", gap: 2 },
  changeText: { fontFamily: fonts.semibold, fontSize: 12 },
});
