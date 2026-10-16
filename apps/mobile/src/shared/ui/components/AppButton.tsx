import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

export type AppButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

interface AppButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: AppButtonVariant;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

export function AppButton({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  disabledReason,
  busy = false,
  busyLabel = "Выполняется…",
  accessibilityLabel,
  testID,
}: Readonly<AppButtonProps>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const unavailable = disabled || busy;
  const backgroundColor = variant === "primary" ? colors.accentFill : variant === "ghost" ? "transparent" : colors.surface;
  const foregroundColor = variant === "primary" ? colors.onAccentFill : variant === "destructive" ? colors.danger : colors.accentInk;
  const borderColor = focused
    ? colors.focusRing
    : variant === "destructive"
      ? colors.danger
      : variant === "secondary"
        ? colors.accentInk
        : "transparent";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (busy ? `${label}. ${busyLabel}` : label)}
      accessibilityHint={disabled && !busy ? disabledReason : undefined}
      accessibilityState={{ disabled: unavailable, busy }}
      disabled={unavailable}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      testID={testID}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: pressed && variant !== "primary" ? colors.surfaceRaised : backgroundColor,
          borderColor,
          opacity: unavailable ? 0.5 : pressed ? 0.82 : 1,
        },
      ]}
    >
      <View style={styles.content}>
        {busy ? <ActivityIndicator size="small" color={foregroundColor} /> : null}
        <Text style={[styles.label, { color: foregroundColor }]}>{busy ? busyLabel : label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderWidth: 2, borderRadius: 8, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  label: { fontSize: 16, lineHeight: 22, fontWeight: "700", textAlign: "center" },
});
