import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { radius, TOUCH_TARGET } from "../theme/style.ts";
import { withAlpha } from "../theme/colorAlpha.ts";

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
  /** Компактная: меньше отступы и текст 13; высота та же — 44 (UI-OWN-048). */
  readonly compact?: boolean;
  /** Плотные панели: 34 dp вместо стандартных 44, без масштабирования всего экрана. */
  readonly size?: "default" | "small";
}

/** Стиль «Зефирка» (UI-OWN-048): главная — заливка акцентом, второстепенная — мягкий фон акцента, без рамок. */
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
  size = "default",
}: Readonly<AppButtonProps>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const unavailable = disabled || busy;
  const backgroundColor = variant === "primary" ? colors.accentFill : variant === "secondary" ? colors.accentSoft
    : variant === "destructive" ? withAlpha(colors.danger, 0.1) : "transparent";
  const foregroundColor = variant === "primary" ? colors.onAccentFill : variant === "destructive" ? colors.danger
    : variant === "secondary" ? colors.onAccentSoft : colors.accentInk;
  const borderColor = focused ? colors.focusRing : "transparent";

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
        size === "small" ? styles.small : null,
        {
          backgroundColor: pressed && variant === "primary" ? colors.accentPressed
            : pressed && variant === "ghost" ? colors.surfaceRaised : backgroundColor,
          borderColor,
          opacity: unavailable ? 0.5 : pressed && variant !== "primary" ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.content}>
        {busy ? <ActivityIndicator size="small" color={foregroundColor} /> : icon?.(foregroundColor) ?? null}
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.label, compact ? styles.compactLabel : null, size === "small" ? styles.smallLabel : null, { color: foregroundColor }]}>{busy ? busyLabel : label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: TOUCH_TARGET, borderRadius: radius.md, borderWidth: 2, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  small: { minHeight: 34, paddingHorizontal: 8 },
  smallLabel: { fontSize: 12, lineHeight: 16 },
  compact: { paddingHorizontal: 10 },
  compactLabel: { fontSize: 13, lineHeight: 17 },
  content: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, textAlign: "center", flexShrink: 1 },
});
