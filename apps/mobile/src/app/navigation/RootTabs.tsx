import { useRef, useState, useSyncExternalStore } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsDrawerPreview } from "../../features/settings/public.ts";
import type { ClientArchivePort, ClientRepositoryPort,
  ClientRosterPort } from "../../features/clients/public.ts";
import type { ClientListController } from "../../read-models/ClientListController.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { CalendarNavigator } from "./CalendarNavigator.tsx";
import { RootHeader } from "./RootHeader.tsx";
import { ArchiveNavigator, ClientsNavigator } from "./RootSectionNavigators.tsx";
import { rootTabs } from "./routeCatalog.ts";
import { TabGlyph } from "./TabGlyph.tsx";

type RootTabRoutes = {
  Clients: undefined;
  Calendar: undefined;
  Archive: undefined;
};

interface RootTabsProps {
  readonly onOpenSettings: () => void;
  readonly onOpenAppearance: () => void;
  readonly onOpenNotificationSettings: () => void;
  readonly onOpenNotifications: () => void;
  readonly onOpenWorkspaceDev: () => void;
  readonly onOpenCreate: () => void;
  readonly onOpenEdit: (clientId: string) => void;
  readonly onOpenClient: (clientId: string) => void;
  readonly onOpenSqliteDev: () => void;
  readonly clients: ClientRepositoryPort & ClientRosterPort & ClientArchivePort;
  readonly clientLists: ClientListController;
}

const Tabs = createBottomTabNavigator<RootTabRoutes>();

/** §15.12: absolute archived count, hidden at 0; never a usage/limit fraction. */
function archiveBadge(count: number | null): string | undefined {
  if (count === null || count <= 0) return undefined;
  return count > 99 ? "99+" : String(count);
}

export function RootTabs({
  onOpenSettings,
  onOpenAppearance,
  onOpenNotificationSettings,
  onOpenNotifications,
  onOpenWorkspaceDev,
  onOpenCreate,
  onOpenEdit,
  onOpenClient,
  onOpenSqliteDev,
  clients,
  clientLists,
}: Readonly<RootTabsProps>) {
  const [menuVisible, setMenuVisible] = useState(false);
  const menuButtonRef = useRef<View>(null);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const counts = useSyncExternalStore(clientLists.counts.subscribe, clientLists.counts.getSnapshot,
    clientLists.counts.getSnapshot);
  const archivedCount = counts.status === "ready" ? counts.data.archived : null;
  return (
    <SafeAreaView edges={["top"]} style={[styles.root, { backgroundColor: colors.canvas }]}>
      <StatusBar barStyle={palette.tone === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.surface} />
      <RootHeader onOpenNotifications={onOpenNotifications} onOpenMenu={() => setMenuVisible(true)} menuButtonRef={menuButtonRef} />
      <Tabs.Navigator
        backBehavior="none"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: colors.accentInk,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
          tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
          tabBarItemStyle: { minHeight: 48 },
        }}
      >
        <Tabs.Screen name="Clients" options={{ tabBarLabel: rootTabs.Clients, tabBarAccessibilityLabel: rootTabs.Clients, tabBarIcon: ({ color }) => <TabGlyph kind="clients" color={color} /> }}>
          {() => <ClientsNavigator onOpenCreate={onOpenCreate}
            onOpenEdit={onOpenEdit} onOpenClient={onOpenClient} repository={clients}
            readModel={clientLists.active} />}
        </Tabs.Screen>
        <Tabs.Screen name="Calendar" component={CalendarNavigator} options={{ tabBarLabel: rootTabs.Calendar, tabBarAccessibilityLabel: rootTabs.Calendar, tabBarIcon: ({ color }) => <TabGlyph kind="calendar" color={color} /> }} />
        <Tabs.Screen name="Archive" options={{ tabBarLabel: rootTabs.Archive,
          tabBarAccessibilityLabel: archivedCount ? `${rootTabs.Archive}, клиентов в архиве: ${archivedCount}` : rootTabs.Archive,
          tabBarBadge: archiveBadge(archivedCount),
          tabBarBadgeStyle: { backgroundColor: colors.accentFill, color: colors.onAccentFill },
          tabBarIcon: ({ color }) => <TabGlyph kind="archive" color={color} /> }}>
          {() => <ArchiveNavigator repository={clients} readModel={clientLists.archived} />}
        </Tabs.Screen>
      </Tabs.Navigator>
      <SettingsDrawerPreview
        visible={menuVisible}
        returnFocusTo={menuButtonRef}
        onClose={() => setMenuVisible(false)}
        onOpenSettings={onOpenSettings}
        onOpenAppearance={onOpenAppearance}
        onOpenNotificationSettings={onOpenNotificationSettings}
        onOpenWorkspaceDev={onOpenWorkspaceDev}
        onOpenSqliteDev={onOpenSqliteDev}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
