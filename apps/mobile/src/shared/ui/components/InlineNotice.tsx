import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export type NoticeKind = "info" | "warning" | "error" | "success";

const markerByKind: Readonly<Record<NoticeKind, string>> = {
  info: "ℹ",
  warning: "!",
  error: "×",
  success: "✓",
};

export function InlineNotice({ kind = "info", children }: Readonly<{ kind?: NoticeKind; children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const markerColor = kind === "error"
    ? colors.danger
    : kind === "warning"
      ? colors.warning
      : kind === "success"
        ? colors.success
        : colors.info;
  return (
    <View
      accessibilityLiveRegion={kind === "error" ? "assertive" : "polite"}
      style={[styles.notice, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]}
    >
      <Text style={[styles.marker, { color: markerColor }]}>{markerByKind[kind]}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { minHeight: 48, borderWidth: 1, borderRadius: 8, padding: 12, flexDirection: "row", alignItems: "flex-start", gap: 10 },
  marker: { minWidth: 16, fontSize: 14, lineHeight: 18, fontFamily: fonts.bold, textAlign: "center" },
  body: { flex: 1, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
