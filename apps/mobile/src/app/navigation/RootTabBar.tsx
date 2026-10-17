import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Archive, CalendarDays, Users, type LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

const tabIcons: Readonly<Record<string, LucideIcon>> = { Clients: Users, Calendar: CalendarDays, Archive };

/** Нижняя панель во всю ширину: иконка + подпись, бейдж, черта под активной (UI-OWN-004). */
export function RootTabBar({ state, descriptors, navigation }: Readonly<BottomTabBarProps>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: insets.bottom }]}>
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
            <Text style={[styles.label, { color, fontFamily: focused ? fonts.semibold : fonts.medium }]}>{label}</Text>
            <View style={[styles.indicator, { backgroundColor: focused ? colors.accentInk : "transparent" }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", borderTopWidth: 1 },
  tab: { flex: 1, minHeight: 60, paddingTop: 8, alignItems: "center", justifyContent: "flex-start", gap: 3 },
  label: { fontSize: 12, lineHeight: 16 },
  indicator: { width: 20, height: 3, borderRadius: 2, marginTop: 2 },
  badge: { position: "absolute", top: -4, left: 14, minWidth: 18, height: 18, paddingHorizontal: 4, borderRadius: 9, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.bold, fontSize: 10, lineHeight: 13 },
});
