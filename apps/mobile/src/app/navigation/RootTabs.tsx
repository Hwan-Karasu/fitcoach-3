import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsDrawerPreview } from "../../features/settings/public.ts";
import type { CalendarCreditPort, CalendarParticipantDirectoryPort,
  CalendarRepositoryPort, GuestLinkRequest } from "../../features/calendar/public.ts";
import type { ClientArchivePort, ClientRepositoryPort,
  ClientRosterPort } from "../../features/clients/public.ts";
import type { ClientListController } from "../../read-models/ClientListController.ts";
import { HeaderScrollReporter } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { CalendarNavigator } from "./CalendarNavigator.tsx";
import { RootHeader } from "./RootHeader.tsx";
import { ArchiveNavigator, ClientsNavigator } from "./RootSectionNavigators.tsx";
import { rootTabs } from "./routeCatalog.ts";
import { RootTabBar } from "./RootTabBar.tsx";

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
  readonly onOpenClient: (clientId: string) => void;
  readonly onOpenSqliteDev: () => void;
  readonly clients: ClientRepositoryPort & ClientRosterPort & ClientArchivePort;
  readonly clientLists: ClientListController;
  readonly calendar: CalendarRepositoryPort;
  readonly calendarParticipants: CalendarParticipantDirectoryPort;
  readonly calendarCredit: CalendarCreditPort;
  readonly onCreateClientFromGuest: (request: GuestLinkRequest) => void;
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
  onOpenClient,
  onOpenSqliteDev,
  clients,
  clientLists,
  calendar,
  calendarParticipants,
  calendarCredit,
  onCreateClientFromGuest,
}: Readonly<RootTabsProps>) {
  const [menuVisible, setMenuVisible] = useState(false);
  const menuButtonRef = useRef<View>(null);
  // Календарь не прокручивается целиком, поэтому сразу показывает название раздела.
  const [scrolled, setScrolled] = useState<Readonly<Record<keyof RootTabRoutes, boolean>>>(
    { Clients: false, Calendar: true, Archive: false });
  const reporters = useMemo(() => ({
    Clients: (value: boolean) => setScrolled((current) => ({ ...current, Clients: value })),
    Archive: (value: boolean) => setScrolled((current) => ({ ...current, Archive: value })),
  }), []);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const counts = useSyncExternalStore(clientLists.counts.subscribe, clientLists.counts.getSnapshot,
    clientLists.counts.getSnapshot);
  const archivedCount = counts.status === "ready" ? counts.data.archived : null;
  return (
    <SafeAreaView edges={["top"]} style={[styles.root, { backgroundColor: colors.canvas }]}>
      <StatusBar barStyle={palette.tone === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.canvas} />
      <Tabs.Navigator
        backBehavior="none"
        tabBar={(props) => <RootTabBar {...props} />}
        screenOptions={{
          sceneStyle: { backgroundColor: colors.canvas },
          // Заголовок корневой вкладки — в одной строке с колокольчиком и меню (UI-OWN-002).
          header: ({ route, options }) => <RootHeader title={options.title ?? ""}
            collapsed={scrolled[route.name as keyof RootTabRoutes]} onOpenNotifications={onOpenNotifications}
            onOpenMenu={() => setMenuVisible(true)} menuButtonRef={menuButtonRef} />,
        }}
      >
        <Tabs.Screen name="Clients" options={{ title: rootTabs.Clients, tabBarLabel: rootTabs.Clients, tabBarAccessibilityLabel: rootTabs.Clients }}>
          {() => <HeaderScrollReporter value={reporters.Clients}>
            <ClientsNavigator onOpenCreate={onOpenCreate} onOpenClient={onOpenClient} repository={clients}
              readModel={clientLists.active} />
          </HeaderScrollReporter>}
        </Tabs.Screen>
        <Tabs.Screen name="Calendar" options={{ title: rootTabs.Calendar, tabBarLabel: rootTabs.Calendar, tabBarAccessibilityLabel: rootTabs.Calendar }}>
          {() => <CalendarNavigator repository={calendar} participants={calendarParticipants}
            credit={calendarCredit} onCreateClientFromGuest={onCreateClientFromGuest} />}
        </Tabs.Screen>
        <Tabs.Screen name="Archive" options={{ title: rootTabs.Archive, tabBarLabel: rootTabs.Archive,
          tabBarAccessibilityLabel: archivedCount ? `${rootTabs.Archive}, клиентов в архиве: ${archivedCount}` : rootTabs.Archive,
          tabBarBadge: archiveBadge(archivedCount) }}>
          {() => <HeaderScrollReporter value={reporters.Archive}>
            <ArchiveNavigator repository={clients} readModel={clientLists.archived} />
          </HeaderScrollReporter>}
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
