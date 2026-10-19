import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { radius, shadow, TOUCH_TARGET } from "../theme/style.ts";

interface SelectionChipProps {
  readonly group: string;
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

export function SelectionChip({ group, label, selected, onPress, disabled = false, disabledReason }: Readonly<SelectionChipProps>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group}: ${label}`}
      accessibilityHint={disabled ? disabledReason : undefined}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.chip,
        selected ? null : shadow.control,
        {
          backgroundColor: selected ? colors.accentFill : colors.surface,
          borderColor: focused ? colors.focusRing : "transparent",
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      <Text style={[styles.label, { color: selected ? colors.onAccentFill : colors.textPrimary }]}>
        {selected ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: TOUCH_TARGET, borderRadius: radius.pill, borderWidth: 2, paddingHorizontal: 14, justifyContent: "center" },
  label: { fontSize: 14, lineHeight: 18, fontFamily: fonts.semibold, textAlign: "center" },
});
