import { StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

export type StatusKind = "neutral" | "info" | "warning" | "action_required" | "success" | "error";

const statusMarker: Readonly<Record<StatusKind, string>> = {
  neutral: "•",
  info: "ℹ",
  warning: "!",
  action_required: "↗",
  success: "✓",
  error: "×",
};

const statusMeaning: Readonly<Record<StatusKind, string>> = {
  neutral: "Статус",
  info: "Информация",
  warning: "Предупреждение",
  action_required: "Требует действия",
  success: "Подтверждено",
  error: "Ошибка",
};

export function StatusTag({ kind, label }: Readonly<{ kind: StatusKind; label: string }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const ink = kind === "warning" ? colors.warning : kind === "action_required" || kind === "error" ? colors.danger
    : kind === "success" ? colors.success : kind === "info" ? colors.accentInk : colors.textSecondary;
  return (
    <View
      accessible
      accessibilityLabel={`${statusMeaning[kind]}: ${label}`}
      style={[styles.tag, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
    >
      <Text style={[styles.marker, { color: ink }]}>{statusMarker[kind]}</Text>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { minHeight: 28, borderWidth: 1, borderRadius: 14, paddingHorizontal: 8, paddingVertical: 3, flexDirection: "row", alignItems: "center", alignSelf: "flex-start", gap: 5 },
  marker: { fontSize: 13, lineHeight: 18, fontWeight: "700" },
  label: { fontSize: 11, lineHeight: 16, fontWeight: "700", flexShrink: 1 },
});
