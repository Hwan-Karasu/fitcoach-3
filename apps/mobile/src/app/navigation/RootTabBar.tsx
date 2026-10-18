import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Archive, CalendarDays, ChevronLeft, ChevronRight, Dumbbell, Ellipsis, House, Users, Utensils, type LucideIcon } from "lucide-react-native";
import { AppIconButton, useWeekNavigationState } from "../../shared/ui/components/public.ts";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

/** Значки всех наборов вкладок: корень (Клиенты/Календарь/Архив) и карточка клиента (Главная/Питание/…). */
const tabIcons: Readonly<Record<string, LucideIcon>> = { Clients: Users, Calendar: CalendarDays, Archive,
  Home: House, Nutrition: Utensils, Training: Dumbbell, More: Ellipsis };

/**
 * Единая плавающая нижняя панель (UI-OWN-018) для всех наборов вкладок: вид один и тот же, меняются только
 * кнопки. Отступы от краёв, радиус 18; иконка + подпись, бейдж, черта под активной.
 */
export function RootTabBar({ state, descriptors, navigation }: Readonly<BottomTabBarProps>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const weeks = useWeekNavigationState();
  return (
    <View style={[styles.dock, { backgroundColor: colors.canvas, paddingBottom: insets.bottom + 8 }]}>
      <View style={[styles.bar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {weeks ? <View style={styles.arrow}><AppIconButton label={`Предыдущая неделя. Сейчас неделя ${weeks.week}`}
          disabled={weeks.previous === null || weeks.busy} onPress={() => weeks.previous?.()}
          icon={<ChevronLeft size={24} color={colors.accentInk} />} /></View> : null}
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
              style={styles.tab}
            >
              <View>
                <Icon size={22} color={color} strokeWidth={focused ? 2.2 : 1.8} />
                {badge !== undefined ? (
                  <View style={[styles.badge, { backgroundColor: colors.accentFill }]}>
                    <Text style={[styles.badgeText, { color: colors.onAccentFill }]}>{String(badge)}</Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
                style={[styles.label, { color, fontFamily: focused ? fonts.semibold : fonts.medium }]}>{label}</Text>
              <View style={[styles.indicator, { backgroundColor: focused ? colors.accentInk : "transparent" }]} />
            </Pressable>
          );
        })}
        {weeks ? <View style={styles.arrow}><AppIconButton label={`Следующая неделя. Сейчас неделя ${weeks.week}`}
          disabled={weeks.next === null || weeks.busy} onPress={() => weeks.next?.()}
          icon={<ChevronRight size={24} color={colors.accentInk} />} /></View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: { justifyContent: "center" },
  dock: { paddingHorizontal: 12, paddingTop: 4 },
  bar: {
    flexDirection: "row", borderWidth: 1, borderRadius: 18, overflow: "visible",
    elevation: 6, shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
  },
  tab: { flex: 1, minHeight: 60, paddingTop: 9, alignItems: "center", justifyContent: "flex-start", gap: 3 },
  label: { fontSize: 12, lineHeight: 16 },
  indicator: { width: 20, height: 3, borderRadius: 2, marginTop: 2 },
  badge: { position: "absolute", top: -4, left: 14, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 13 },
});
