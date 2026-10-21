import { StyleSheet, View } from "react-native";
import type { LucideIcon } from "lucide-react-native";
import { chunkRows } from "./choiceRows.ts";
import { SelectionChip } from "./SelectionChip.tsx";

/**
 * Пилюли выбора ровной сеткой: одинаковые столбцы на всю ширину контейнера, высота ряда — по самой высокой подписи.
 * Выбор (один или несколько) задаёт вызывающий: сетка только рисует и сообщает о нажатии.
 */
export function ChoiceGrid({ group, items, selected, columns, onPress, disabled = false }: Readonly<{
  group: string;
  items: readonly Readonly<{ id: string; label: string; icon?: LucideIcon }>[];
  selected: readonly string[];
  columns: number;
  onPress: (id: string) => void;
  disabled?: boolean;
}>) {
  const dense = columns >= 6;
  return (
    <View style={[styles.grid, dense ? styles.gridDense : null]}>
      {chunkRows(items, columns).map((row) => (
        <View key={row[0]!.id} style={[styles.row, dense ? styles.gridDense : null]}>
          {row.map((item) => (
            <SelectionChip key={item.id} fill dense={dense} icon={item.icon} group={group} label={item.label} disabled={disabled}
              selected={selected.includes(item.id)} onPress={() => onPress(item.id)} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 8 },
  gridDense: { gap: 4 },
  row: { flexDirection: "row", alignItems: "stretch", gap: 8 },
});
