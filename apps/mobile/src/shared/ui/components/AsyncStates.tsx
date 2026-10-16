import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { AppButton } from "./AppButton.tsx";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

export type EmptyReason = "no-data" | "no-match" | "unavailable";

const emptyMark: Readonly<Record<EmptyReason, string>> = {
  "no-data": "○",
  "no-match": "⌕",
  unavailable: "–",
};

interface EmptyStateProps {
  readonly reason: EmptyReason;
  readonly title: string;
  readonly body: string;
  readonly action?: Readonly<{ label: string; onPress: () => void }>;
}

export function EmptyState({ reason, title, body, action }: Readonly<EmptyStateProps>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text accessibilityElementsHidden style={[styles.mark, { color: colors.accentInk }]}>{emptyMark[reason]}</Text>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{body}</Text>
      {action ? <AppButton variant="secondary" label={action.label} onPress={action.onPress} /> : null}
    </View>
  );
}

export function LoadingState({ label, background = false }: Readonly<{ label: string; background?: boolean }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={background ? styles.backgroundLoading : [styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <ActivityIndicator color={colors.accentInk} />
      <Text style={[styles.loadingLabel, { color: colors.textSecondary }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 12, padding: 24, minHeight: 192, alignItems: "center", justifyContent: "center", gap: 8 },
  mark: { fontSize: 30, lineHeight: 36 },
  title: { fontSize: 16, lineHeight: 22, fontWeight: "700", textAlign: "center" },
  body: { fontSize: 14, lineHeight: 20, textAlign: "center" },
  backgroundLoading: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  loadingLabel: { fontSize: 13, lineHeight: 18 },
});
