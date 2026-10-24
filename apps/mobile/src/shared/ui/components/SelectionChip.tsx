import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import type { LucideIcon } from "lucide-react-native";
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
  /** Ячейка сетки: занимает свою долю ряда, подпись переносится до двух строк, без «✓» (выбор виден по заливке). */
  readonly fill?: boolean;
  /** Узкая ячейка (шкала 1–10 в один ряд): без боковых полей. */
  readonly dense?: boolean;
  /** Компактный пример или плотная панель; дополнительная область касания сохраняется. */
  readonly compact?: boolean;
  /** Значок слева от подписи (lucide). */
  readonly icon?: LucideIcon;
}

export function SelectionChip({ group, label, selected, onPress, disabled = false, disabledReason, fill = false, dense = false, compact = false, icon: Icon }: Readonly<SelectionChipProps>) {
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
      hitSlop={compact ? { top: 7, bottom: 7 } : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.chip,
        fill ? styles.fill : null,
        dense ? styles.dense : null,
        compact ? styles.compact : null,
        selected ? null : shadow.chip,
        {
          backgroundColor: selected ? (pressed ? colors.accentPressed : colors.accentFill) : colors.input,
          borderColor: focused ? colors.focusRing : selected ? "transparent" : colors.border,
          opacity: disabled ? 0.5 : pressed && !selected ? 0.8 : 1,
        },
      ]}
    >
      {Icon === undefined ? null : <Icon size={16} color={selected ? colors.onAccentFill : colors.textSecondary} />}
      <Text style={[styles.label, compact ? styles.compactLabel : null, styles.labelFlex, { color: selected ? colors.onAccentFill : colors.textSecondary }]}>
        {selected && !fill ? `✓ ${label}` : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { minHeight: TOUCH_TARGET, borderRadius: radius.pill, borderWidth: 2, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  fill: { flex: 1, minWidth: 0, paddingHorizontal: 6, paddingVertical: 4 },
  labelFlex: { flexShrink: 1 },
  dense: { paddingHorizontal: 0 },
  compact: { minHeight: 30, paddingHorizontal: 10 },
  compactLabel: { fontSize: 12, lineHeight: 16 },
  label: { fontSize: 14, lineHeight: 18, fontFamily: fonts.semibold, textAlign: "center" },
});
