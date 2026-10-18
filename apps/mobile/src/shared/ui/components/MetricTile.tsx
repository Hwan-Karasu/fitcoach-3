import { StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export interface MetricTileData {
  readonly label: string;
  readonly value: string | number | null;
  readonly unit?: string;
  readonly status?: string;
}

export function MetricTile({ label, value, unit, status }: Readonly<MetricTileData>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const displayValue = value === null ? "—" : String(value);
  const spokenValue = value === null ? "нет данных" : `${displayValue}${unit ? ` ${unit}` : ""}`;
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${spokenValue}${status ? `, ${status}` : ""}`}
      style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
      <View style={styles.valueLine}>
        <Text style={[styles.value, { color: colors.textPrimary }]}>{displayValue}</Text>
        {value !== null && unit ? <Text style={[styles.unit, { color: colors.textSecondary }]}>{unit}</Text> : null}
      </View>
      {status ? <Text style={[styles.status, { color: colors.textSecondary }]}>{status}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { minWidth: 100, minHeight: 88, flexGrow: 1, borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
  label: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  valueLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: 4 },
  value: { fontSize: 18, lineHeight: 23, fontFamily: fonts.bold },
  unit: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  status: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
});
