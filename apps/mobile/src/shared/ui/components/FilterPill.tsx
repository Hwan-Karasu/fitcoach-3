import { useState, type ReactNode, type Ref } from "react";
import { Pressable, StyleSheet, Text, type View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

interface FilterPillProps {
  readonly label: string;
  /** Как прочитать пилюлю TalkBack, например «Сортировка: Имя А–Я». */
  readonly accessibilityLabel: string;
  readonly onPress: () => void;
  readonly selected?: boolean;
  /** Пилюля открывает выпадающий список — стрелка ▾. */
  readonly menu?: boolean;
  /** Список сейчас раскрыт: стрелка смотрит вверх, TalkBack читает «развёрнуто». */
  readonly expanded?: boolean;
  /** Якорь, под которым раскрывается выпадающий список. */
  readonly anchorRef?: Ref<View>;
  /** Значок слева; получает цвет текста. */
  readonly icon?: (color: string) => ReactNode;
  /** Растянуться: ширина по тексту плюс равная доля свободного места ряда; текст не обрезается раньше времени. */
  readonly grow?: boolean;
}

/** Фильтр-пилюля списков (UI-OWN-017): скругление 8, видимая высота 36, зона нажатия 48. */
export function FilterPill({ label, accessibilityLabel, onPress, selected = false, menu = false, expanded = false, anchorRef, icon, grow = false }: Readonly<FilterPillProps>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const ink = selected ? colors.onAccentFill : colors.textPrimary;
  return (
    <Pressable
      ref={anchorRef}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={menu ? { expanded } : { selected }}
      hitSlop={{ top: 6, bottom: 6 }}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.pill, grow ? styles.grow : null, {
        backgroundColor: selected ? colors.accentFill : pressed ? colors.surfaceRaised : colors.surface,
        borderColor: focused ? colors.focusRing : selected ? colors.accentFill : colors.border,
        borderWidth: focused ? 2 : 1,
      }]}
    >
      {icon?.(ink) ?? null}
      <Text numberOfLines={1} style={[styles.label, grow ? styles.labelFull : null, { color: ink }]}>{label}</Text>
      {menu ? <ChevronDown size={14} color={ink} strokeWidth={2}
        style={expanded ? { transform: [{ rotate: "180deg" }] } : undefined} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: 36, borderRadius: 8, paddingHorizontal: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 },
  // Ширина по тексту, без сжатия; свободное место ряда делится поровну.
  grow: { flexGrow: 1, flexShrink: 0, flexBasis: "auto" },
  labelFull: { flexShrink: 0 },
  label: { flexShrink: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
});
