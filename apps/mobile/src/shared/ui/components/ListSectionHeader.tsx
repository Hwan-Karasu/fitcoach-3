import { StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

/** Заголовок раздела списка: название слева, счётчик справа, не сворачивается (UI-OWN-012). */
export function ListSectionHeader({ title, count }: Readonly<{ title: string; count?: number }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View accessible accessibilityRole="header"
      accessibilityLabel={count === undefined ? title : `${title}, ${count}`} style={styles.row}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      {count === undefined ? null : <Text style={[styles.count, { color: colors.textSecondary }]}>{count}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingTop: 8 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  count: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
});
