import { useSyncExternalStore } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { clearReadIssues, readIssueCount, subscribeReadIssues } from "../../diagnostics/ReadIssues.ts";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

export function DataReadNotice() {
  const count = useSyncExternalStore(subscribeReadIssues, readIssueCount);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  if (count === 0) return null;
  return <View accessibilityRole="alert" style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.warning }]}>
    <Text style={[styles.text, { color: colors.textPrimary }]}>Не удалось прочитать часть записей. Остальные данные доступны.</Text>
    <Pressable accessibilityRole="button" onPress={clearReadIssues} style={styles.close}>
      <Text style={{ color: colors.textPrimary }}>Скрыть</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  notice: { borderWidth: 1, padding: 12, flexDirection: "row", alignItems: "center", gap: 8 },
  text: { flex: 1, fontSize: 13 },
  close: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
});
