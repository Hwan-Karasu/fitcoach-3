import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

interface FilterPillProps {
  readonly label: string;
  /** Как прочитать пилюлю TalkBack, например «Сортировка: Имя А–Я». */
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly selected?: boolean;
  /** Пилюля открывает список вариантов — стрелка ▾. */
  readonly menu?: boolean;
}

/** Фильтр-пилюля списков (UI-OWN-008): полное скругление, видимая высота 36, зона нажатия 48. */
export function FilterPill({ label, accessibilityLabel, onPress, selected = false, menu = false }: Readonly<FilterPillProps>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const ink = selected ? colors.onAccentFill : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={menu ? { expanded: false } : { selected }}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.pill, {
        backgroundColor: selected ? colors.accentFill : pressed ? colors.surfaceRaised : colors.surface,
        borderColor: focused ? colors.focusRing : selected ? colors.accentFill : colors.border,
        borderWidth: focused ? 2 : 1,
      }]}
    >
      <Text numberOfLines={1} style={[styles.label, { color: ink }]}>{label}</Text>
      {menu ? <ChevronDown size={16} color={ink} strokeWidth={2} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 36, borderRadius: 18, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 4 },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
});
