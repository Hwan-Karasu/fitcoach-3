import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

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
        {
          backgroundColor: selected ? colors.accentFill : colors.surface,
          borderColor: focused ? colors.focusRing : selected ? colors.accentFill : colors.border,
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
  chip: { minHeight: 48, borderRadius: 24, borderWidth: 2, paddingHorizontal: 16, paddingVertical: 8, justifyContent: "center" },
  label: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, textAlign: "center" },
});
