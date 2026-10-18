import { useState, type ReactNode, type Ref } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

interface AppIconButtonProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly badgeCount?: number;
  readonly buttonRef?: Ref<View>;
  readonly testID?: string;
  /** Узкая кнопка для плотных рядов: ширина 40, зона нажатия добирается до 48 через hitSlop. */
  readonly compact?: boolean;
}

export function AppIconButton({ icon, label, onPress, disabled = false, disabledReason, badgeCount, buttonRef, testID, compact = false }: Readonly<AppIconButtonProps>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const unreadCount = Math.max(0, Math.floor(badgeCount ?? 0));
  return (
    <Pressable
      ref={buttonRef}
      accessibilityRole="button"
      accessibilityLabel={unreadCount > 0 ? `${label}, непрочитанных: ${unreadCount}` : label}
      accessibilityHint={disabled ? disabledReason : undefined}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      testID={testID}
      hitSlop={compact ? { left: 6, right: 6, top: 4, bottom: 4 } : 3}
      style={({ pressed }) => [styles.button, compact ? styles.compact : null, { borderColor: focused ? colors.focusRing : "transparent", opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}
    >
      {icon}
      {unreadCount > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.accentFill }]}>
          <Text style={[styles.badgeText, { color: colors.onAccentFill }]}>{unreadCount > 99 ? "99+" : unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  compact: { width: 36, height: 40 },
  button: { width: 42, height: 42, borderWidth: 2, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 1, right: 0, minWidth: 17, height: 17, paddingHorizontal: 3, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10, lineHeight: 11, fontFamily: fonts.bold },
});
