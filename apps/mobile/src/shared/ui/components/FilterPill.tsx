import { useState, type ReactNode, type Ref } from "react";
import { Pressable, StyleSheet, Text, type View } from "react-native";
import { ChevronDown } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { radius, shadow, TOUCH_TARGET } from "../theme/style.ts";

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

/** Фильтр-пилюля списков (UI-OWN-017; «Зефирка»: белая, высота 44, радиус 20, тень, без рамки). */
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
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.pill, selected ? null : shadow.control, grow ? styles.grow : null, {
        backgroundColor: selected ? colors.accentFill : pressed ? colors.surfaceRaised : colors.surface,
        borderColor: focused ? colors.focusRing : "transparent",
      }]}
    >
      {icon?.(ink) ?? null}
      <Text numberOfLines={1} adjustsFontSizeToFit={grow} minimumFontScale={0.7} style={[styles.label, grow ? styles.labelFull : null, { color: ink }]}>{label}</Text>
      {menu ? <ChevronDown size={16} color={ink} strokeWidth={2.4}
        style={expanded ? { transform: [{ rotate: "180deg" }] } : undefined} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { minHeight: TOUCH_TARGET, borderRadius: radius.pill, borderWidth: 2, flexDirection: "row", alignItems: "center",
    justifyContent: "center", gap: 4, paddingHorizontal: 10 },
  // Растягивается на свободное место ряда и сжимается первой, если места мало.
  grow: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  labelFull: { flexShrink: 1, textAlign: "center" },
  label: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
});
