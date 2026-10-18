import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export type AppButtonVariant = "primary" | "secondary" | "ghost" | "destructive";

interface AppButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: AppButtonVariant;
  /** Иконка слева от подписи; получает цвет текста кнопки (UI-OWN-010). */
  readonly icon?: (color: string) => ReactNode;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly busy?: boolean;
  readonly busyLabel?: string;
  readonly accessibilityLabel?: string;
  readonly testID?: string;
  /** Компактная кнопка для плотных окон: высота 40, текст 14. */
  readonly compact?: boolean;
}

/** Главная — залитая акцентом; второстепенные — тонкая рамка без заливки (UI-OWN-008/010). */
export function AppButton({
  label,
  onPress,
  variant = "primary",
  icon,
  disabled = false,
  disabledReason,
  busy = false,
  busyLabel = "Выполняется…",
  accessibilityLabel,
  testID,
  compact = false,
}: Readonly<AppButtonProps>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const unavailable = disabled || busy;
  const backgroundColor = variant === "primary" ? colors.accentFill : "transparent";
  const foregroundColor = variant === "primary" ? colors.onAccentFill : variant === "destructive" ? colors.danger : colors.accentInk;
  const borderColor = focused
    ? colors.focusRing
    : variant === "destructive"
      ? colors.danger
      : variant === "secondary"
        ? colors.border
        : backgroundColor;

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
        compact ? styles.compact : null,
        {
          backgroundColor: pressed && variant !== "primary" ? colors.surfaceRaised : backgroundColor,
          borderColor,
          borderWidth: focused ? 2 : 1,
          opacity: unavailable ? 0.5 : pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.content}>
        {busy ? <ActivityIndicator size="small" color={foregroundColor} /> : icon?.(foregroundColor) ?? null}
        <Text style={[styles.label, compact ? styles.compactLabel : null, { color: foregroundColor }]}>{busy ? busyLabel : label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: 8, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  compact: { minHeight: 48, paddingHorizontal: 12 },
  compactLabel: { fontSize: 14, lineHeight: 19 },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, textAlign: "center", flexShrink: 1 },
});
