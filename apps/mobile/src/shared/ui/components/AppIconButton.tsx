import { useState, type ReactNode, type Ref } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { TOUCH_TARGET } from "../theme/style.ts";

interface AppIconButtonProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly badgeCount?: number;
  readonly buttonRef?: Ref<View>;
  readonly testID?: string;
  /** Оставлен для совместимости: размер всегда 44 (UI-OWN-048). */
  readonly compact?: boolean;
}

export function AppIconButton({ icon, label, onPress, disabled = false, disabledReason, badgeCount, buttonRef, testID }: Readonly<AppIconButtonProps>) {
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
      style={({ pressed }) => [styles.button, { borderColor: focused ? colors.focusRing : "transparent", opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}
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
  button: { width: TOUCH_TARGET, height: TOUCH_TARGET, borderWidth: 2, borderRadius: TOUCH_TARGET / 2, alignItems: "center", justifyContent: "center" },
  badge: { position: "absolute", top: 1, right: 0, minWidth: 17, height: 17, paddingHorizontal: 3, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  badgeText: { fontSize: 10, lineHeight: 11, fontFamily: fonts.bold },
});
