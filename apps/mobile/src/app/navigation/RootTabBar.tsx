import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Archive, CalendarDays, ChevronLeft, ChevronRight, Dumbbell, Ellipsis, House, Users, Utensils, type LucideIcon } from "lucide-react-native";
import { AppIconButton, useTabBarSlots } from "../../shared/ui/components/public.ts";
import { focusedLeafKey } from "./focusedLeafKey.ts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { shadow } from "../../shared/ui/theme/style.ts";

/** Значки всех наборов вкладок: корень (Клиенты/Календарь/Архив) и карточка клиента (Главная/Питание/…). */
const tabIcons: Readonly<Record<string, LucideIcon>> = { Clients: Users, Calendar: CalendarDays, Archive,
  Home: House, Nutrition: Utensils, Training: Dumbbell, More: Ellipsis };

/**
 * Единая плавающая нижняя панель (UI-OWN-018) для всех наборов вкладок: вид один и тот же, меняются только
 * кнопки. «Зефирка» (UI-OWN-048): белая, радиус 26, тень; активная вкладка — мягкий фон акцента.
 */
export function RootTabBar({ state, descriptors, navigation }: Readonly<BottomTabBarProps>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  // Что положил в панель экран, который сейчас в фокусе (стрелки недель, строка переключателя): выбор — по состоянию навигации.
  const { weeks, dock } = useTabBarSlots(focusedLeafKey(state));
  // Со строкой экрана панель остаётся той же высоты: кнопки вкладок ужимаются и освобождают под неё место.
  const compact = dock !== null && dock !== undefined;
  return (
    <View style={[styles.dock, { backgroundColor: colors.canvas, paddingBottom: insets.bottom + 6 }]}>
      <View style={[styles.bar, compact ? styles.barCompact : null, shadow.floating, { backgroundColor: colors.surface }]}>
        {compact ? <View style={styles.dockRow}>{dock}</View> : null}
        <View style={[styles.tabsRow, compact ? styles.tabsRowCompact : null]}>
        {weeks ? <View style={styles.arrow}>{compact
          ? <CompactArrow label={`Предыдущая неделя. Сейчас неделя ${weeks.week}`} disabled={weeks.previous === null || weeks.busy === true}
            onPress={() => weeks.previous?.()} icon={<ChevronLeft size={20} color={colors.accentInk} />} />
          : <AppIconButton label={`Предыдущая неделя. Сейчас неделя ${weeks.week}`}
            disabled={weeks.previous === null || weeks.busy} onPress={() => weeks.previous?.()}
            icon={<ChevronLeft size={24} color={colors.accentInk} />} />}</View> : null}
        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options;
          const focused = state.index === index;
          const color = focused ? colors.accentInk : colors.textSecondary;
          const label = typeof options?.tabBarLabel === "string" ? options.tabBarLabel : route.name;
          const badge = options?.tabBarBadge;
          const Icon = tabIcons[route.name] ?? Users;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={options?.tabBarAccessibilityLabel ?? label}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              style={[styles.tab, compact ? styles.tabCompact : null, focused ? [styles.focused, { backgroundColor: colors.accentSoft }] : null]}
            >
              <View>
                <Icon size={compact ? 17 : 22} color={color} strokeWidth={focused ? 2.2 : 1.9} />
                {badge !== undefined ? (
                  <View style={[styles.badge, { backgroundColor: colors.accentFill }]}>
                    <Text style={[styles.badgeText, { color: colors.onAccentFill }]}>{String(badge)}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
                style={[styles.label, compact ? styles.labelCompact : null, { color, fontFamily: focused ? fonts.bold : fonts.semibold }]}>{label}</Text>
            </Pressable>
          );
        })}
        {weeks ? <View style={styles.arrow}>{compact
          ? <CompactArrow label={`Следующая неделя. Сейчас неделя ${weeks.week}`} disabled={weeks.next === null || weeks.busy === true}
            onPress={() => weeks.next?.()} icon={<ChevronRight size={20} color={colors.accentInk} />} />
          : <AppIconButton label={`Следующая неделя. Сейчас неделя ${weeks.week}`}
            disabled={weeks.next === null || weeks.busy} onPress={() => weeks.next?.()}
            icon={<ChevronRight size={24} color={colors.accentInk} />} />}</View> : null}
        </View>
      </View>
    </View>
  );
}

/** Стрелка недели в ужатой панели: 30 dp в раскладке (иначе строка кнопок выросла бы до 44 dp), область нажатия — через hitSlop. */
function CompactArrow({ label, disabled, onPress, icon }: Readonly<{ label: string; disabled: boolean; onPress: () => void; icon: ReactNode }>) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      hitSlop={{ top: 7, bottom: 7, left: 6, right: 6 }}
      style={({ pressed }) => [styles.arrowCompact, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}>
      {icon}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  arrow: { justifyContent: "center" },
  /** Подложка плашки (фон экрана): тонкая — поля 12 по бокам, снизу 6 над жестовой зоной, сверху вплотную к экрану. */
  dock: { paddingHorizontal: 12 },
  bar: { borderRadius: 26, padding: 8, gap: 6 },
  /** Со строкой экрана: те же 76 dp (6 + 32 + 2 + 30 + 6), кнопки ужаты. */
  barCompact: { padding: 6, gap: 2 },
  /** Строка экрана над вкладками (переключатель участников): внутри той же плашки. */
  dockRow: {},
  tabsRow: { flexDirection: "row", gap: 6, minHeight: 60 },
  tabsRowCompact: { minHeight: 30 },
  arrowCompact: { width: 32, height: 30, alignItems: "center", justifyContent: "center" },
  tabCompact: { gap: 0, borderRadius: 12 },
  labelCompact: { fontSize: 11, lineHeight: 12 },
  tab: { flex: 1, borderRadius: 18, alignItems: "center", justifyContent: "center", gap: 3 },
  focused: { flex: 1.25 },
  label: { fontSize: 12, lineHeight: 15 },
  badge: { position: "absolute", top: -4, left: 14, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14 },
});
