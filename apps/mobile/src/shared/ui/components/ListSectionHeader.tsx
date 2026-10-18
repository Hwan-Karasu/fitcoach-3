import { StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

/** Заголовок раздела списка: название слева, счётчик справа, не сворачивается (UI-OWN-012). */
export function ListSectionHeader({ title, count, accent = false }: Readonly<{ title: string; count?: number; accent?: boolean }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const ink = accent ? colors.accentInk : undefined;
  return (
    <View accessible accessibilityRole="header"
      accessibilityLabel={count === undefined ? title : `${title}, ${count}`} style={styles.row}>
      <Text style={[styles.title, { color: ink ?? colors.textPrimary }]}>{title}</Text>
      {count === undefined ? null : <Text style={[styles.count, { color: ink ?? colors.textSecondary }]}>{count}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingTop: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  count: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16 },
});
