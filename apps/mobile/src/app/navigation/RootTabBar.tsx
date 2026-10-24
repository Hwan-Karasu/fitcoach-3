import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Archive, CalendarDays, ChevronLeft, ChevronRight, Dumbbell, Ellipsis, House, Users, Utensils, type LucideIcon } from "lucide-react-native";
import { useBottomBarLayout, useTabBarSlots } from "../../shared/ui/components/public.ts";
import { focusedLeafKey } from "./focusedLeafKey.ts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { shadow } from "../../shared/ui/theme/style.ts";
import { ClientsListShortcut } from "./ClientsListShortcut.tsx";
import { navigationBorder } from "../../shared/ui/theme/navigationBorder.ts";

/** Значки всех наборов вкладок: корень (Клиенты/Календарь/Архив) и карточка клиента (Главная/Питание/…). */
const tabIcons: Readonly<Record<string, LucideIcon>> = { Clients: Users, Calendar: CalendarDays, Archive,
  Home: House, Nutrition: Utensils, Training: Dumbbell, More: Ellipsis };

/**
 * Единая плавающая нижняя панель (UI-OWN-018) для всех наборов вкладок: вид один и тот же, меняются только
 * кнопки. «Зефирка» (UI-OWN-048): белая, радиус 26, тень; активная вкладка — мягкий фон акцента.
 */
export function RootTabBar({ state, descriptors, navigation }: Readonly<BottomTabBarProps>) {
  const { palette, navigationAppearance } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const onBarLayout = useBottomBarLayout();
  // Что положил в панель экран, который сейчас в фокусе (стрелки недель, строка переключателя): выбор — по состоянию навигации.
  const { weeks, dock } = useTabBarSlots(focusedLeafKey(state));
  // Со строкой экрана панель остаётся той же высоты: кнопки вкладок ужимаются и освобождают под неё место.
  const compact = dock !== null && dock !== undefined;
  const showClientsShortcut = navigationAppearance.showClientListShortcut && !state.routes.some((route) => route.name === "Clients");
  return (
    <View onLayout={onBarLayout} style={[styles.dock, { backgroundColor: colors.canvas, paddingBottom: insets.bottom + 4 }]}>
      <View style={[styles.bar, compact ? styles.barCompact : null, weeks ? styles.barWithWeeks : null, shadow.floating, { backgroundColor: colors.navigation, borderColor: navigationBorder(colors) }]}>
        {compact ? <View>{dock}</View> : null}
        <View style={styles.navigationRow}>
        {weeks ? <WeekArrow label={`Предыдущая неделя. Сейчас неделя ${weeks.week}`}
          disabled={weeks.previous === null || weeks.busy === true} onPress={() => weeks.previous?.()}
          icon={<ChevronLeft size={32} strokeWidth={2.2} color={colors.accentInk} />} /> : null}
        <View style={styles.barContent}>
        <View style={[styles.tabsRow, navigationAppearance.hideNavigationLabels ? styles.tabsRowIcons : null, compact ? styles.tabsRowCompact : null]}>
        {state.routes.map((route, index) => {
          const options = descriptors[route.key]?.options;
          const focused = state.index === index;
          const color = focused ? colors.onAccentSoft : colors.iconSecondary;
          const label = typeof options?.tabBarLabel === "string" ? options.tabBarLabel : route.name;
          const badge = options?.tabBarBadge;
          const Icon = tabIcons[route.name] ?? Users;
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              hitSlop={navigationAppearance.hideNavigationLabels ? { top: 4, bottom: 4 } : undefined}
              accessibilityLabel={options?.tabBarAccessibilityLabel ?? label}
              onPress={() => {
                const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
              }}
              style={[styles.tab, compact ? styles.tabCompact : null, focused ? { backgroundColor: colors.accentSoft } : null]}
            >
              <View>
                <Icon size={compact ? 17 : 20} color={color} strokeWidth={focused ? 2.2 : 1.9} />
                {badge !== undefined ? (
                  <View style={[styles.badge, { backgroundColor: colors.accentFill }]}>
                    <Text style={[styles.badgeText, { color: colors.onAccentFill }]}>{String(badge)}</Text>
                  </View>
                ) : null}
              </View>
              {navigationAppearance.hideNavigationLabels ? null : <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
                style={[styles.label, compact ? styles.labelCompact : null, { color, fontFamily: focused ? fonts.bold : fonts.semibold }]}>{label}</Text>}
            </Pressable>
          );
        })}
        </View>
        {showClientsShortcut ? <ClientsListShortcut /> : null}
        </View>
        {weeks ? <WeekArrow label={`Следующая неделя. Сейчас неделя ${weeks.week}`}
          disabled={weeks.next === null || weeks.busy === true} onPress={() => weeks.next?.()}
          icon={<ChevronRight size={32} strokeWidth={2.2} color={colors.accentInk} />} /> : null}
        </View>
      </View>
    </View>
  );
}

/** Стрелки сохраняют положение; область нажатия начинается ниже строки участников. */
function WeekArrow({ label, disabled, onPress, icon }: Readonly<{ label: string; disabled: boolean; onPress: () => void; icon: ReactNode }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <View pointerEvents="box-none" style={styles.weekArrowColumn}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.weekArrow, { backgroundColor: pressed ? colors.accentSoft : "transparent", opacity: disabled ? 0.35 : 1 }]}>
      {icon}
    </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  barContent: { flex: 1, minWidth: 0, gap: 2 },
  navigationRow: { flexDirection: "row", alignItems: "stretch", gap: 2 },
  weekArrowColumn: { width: 36, minHeight: 44, alignSelf: "stretch", justifyContent: "center" },
  weekArrow: { width: 36, height: 44, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  barWithWeeks: { paddingHorizontal: 2 },
  /** Подложка плашки (фон экрана): тонкая — поля 12 по бокам, снизу 6 над жестовой зоной, сверху вплотную к экрану. */
  dock: { paddingHorizontal: 12 },
  bar: { borderRadius: 22, borderWidth: 1, padding: 6, gap: 2 },
  /** Со строкой экрана кнопки вкладок ужаты, переключатель участников остаётся внутри панели. */
  barCompact: { padding: 4, gap: 2 },
  /** Строка экрана над вкладками (переключатель участников): внутри той же плашки. */
  tabsRow: { flexDirection: "row", gap: 4, minHeight: 44 },
  tabsRowIcons: { minHeight: 36 },
  tabsRowCompact: { minHeight: 30 },
  tabCompact: { gap: 0, borderRadius: 12 },
  labelCompact: { fontSize: 11, lineHeight: 12 },
  tab: { flex: 1, flexBasis: 0, minWidth: 0, borderRadius: 14, alignItems: "center", justifyContent: "center", gap: 1 },
  label: { fontSize: 11, lineHeight: 13 },
  badge: { position: "absolute", top: -4, left: 14, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14 },
});
