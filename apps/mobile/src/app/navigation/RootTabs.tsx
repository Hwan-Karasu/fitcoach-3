import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { StatusBar, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsDrawerPreview } from "../../features/settings/public.ts";
import type { CalendarCreditPort, CalendarParticipantDirectoryPort,
  CalendarRepositoryPort, GuestLinkRequest } from "../../features/calendar/public.ts";
import type { ClientArchivePort, ClientRepositoryPort,
  ClientRosterPort, RosterOverviewPort } from "../../features/clients/public.ts";
import type { ClientListController } from "../../read-models/ClientListController.ts";
import { HeaderScrollReporter, HeaderSearchProvider, type HeaderSearchState } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { CalendarNavigator, type CalendarStackRoutes } from "./CalendarNavigator.tsx";
import { getFocusedRouteNameFromRoute, StackActions, type NavigatorScreenParams } from "@react-navigation/native";
import { RootHeader, type RootHeaderSearch } from "./RootHeader.tsx";
import { ArchiveNavigator, ClientsNavigator } from "./RootSectionNavigators.tsx";
import { rootTabs } from "./routeCatalog.ts";
import { RootTabBar } from "./RootTabBar.tsx";

type RootTabRoutes = {
  Clients: undefined;
  Calendar: NavigatorScreenParams<CalendarStackRoutes> | undefined;
  Archive: undefined;
};

interface RootTabsProps {
  readonly onOpenSettings: () => void;
  readonly onOpenAppearance: () => void;
  readonly onOpenNotificationSettings: () => void;
  readonly onOpenNotifications: () => void;
  readonly onOpenWorkspaceDev?: () => void;
  readonly onOpenCreate: () => void;
  readonly onOpenClient: (clientId: string) => void;
  readonly onOpenSqliteDev?: () => void;
  readonly clients: ClientRepositoryPort & ClientRosterPort & ClientArchivePort;
  readonly clientLists: ClientListController;
  readonly rosterOverview: RosterOverviewPort;
  readonly calendar: CalendarRepositoryPort;
  readonly calendarParticipants: CalendarParticipantDirectoryPort;
  readonly calendarCredit: CalendarCreditPort;
  readonly onCreateClientFromGuest: (request: GuestLinkRequest) => void;
}

const Tabs = createBottomTabNavigator<RootTabRoutes>();

/** §15.12: абсолютное число клиентов, скрыто при 0; никогда не «использовано из лимита». */
function countBadge(count: number | null): string | undefined {
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
  rosterOverview,
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
    // Одинаковое значение не меняет состояние — шапка не перерисовывается на каждом событии прокрутки.
    Clients: (value: boolean) => setScrolled((current) => current.Clients === value ? current : { ...current, Clients: value }),
    Archive: (value: boolean) => setScrolled((current) => current.Archive === value ? current : { ...current, Archive: value }),
  }), []);
  // Поиск «Клиентов» и «Архива» живёт в шапке (UI-OWN-019): лупа раскрывает поле, «назад» закрывает и сбрасывает.
  type SearchTab = "Clients" | "Archive";
  const [search, setSearch] = useState<Readonly<Record<SearchTab, Readonly<{ open: boolean; query: string }>>>>(
    { Clients: { open: false, query: "" }, Archive: { open: false, query: "" } });
  const patchSearch = useCallback((tab: SearchTab, next: Partial<{ open: boolean; query: string }>) =>
    setSearch((current) => ({ ...current, [tab]: { ...current[tab], ...next } })), []);
  const searchContexts = useMemo((): Readonly<Record<SearchTab, HeaderSearchState>> => ({
    Clients: { query: search.Clients.query, setQuery: (query) => patchSearch("Clients", { query }) },
    Archive: { query: search.Archive.query, setQuery: (query) => patchSearch("Archive", { query }) },
  }), [patchSearch, search]);
  const headerSearch = (tab: keyof RootTabRoutes): RootHeaderSearch | undefined => tab === "Calendar" ? undefined : {
    open: search[tab].open, query: search[tab].query,
    placeholder: tab === "Clients" ? "Поиск по клиентам" : "Поиск по архиву",
    onOpen: () => patchSearch(tab, { open: true }),
    onChangeQuery: (query) => patchSearch(tab, { query }),
    onClose: () => patchSearch(tab, { open: false, query: "" }),
  };
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const counts = useSyncExternalStore(clientLists.counts.subscribe, clientLists.counts.getSnapshot,
    clientLists.counts.getSnapshot);
  const archivedCount = counts.status === "ready" ? counts.data.archived : null;
  const activeCount = counts.status === "ready" ? counts.data.active : null;
  return (
    <SafeAreaView edges={["top"]} style={[styles.root, { backgroundColor: colors.canvas }]}>
      <StatusBar barStyle={palette.tone === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.canvas} />
      <Tabs.Navigator
        backBehavior="none"
        tabBar={(props) => <RootTabBar {...props} />}
        screenOptions={{
          sceneStyle: { backgroundColor: colors.canvas },
          // Заголовок корневой вкладки — в одной строке с колокольчиком и меню (UI-OWN-002).
          header: ({ route, options, navigation }) => {
            const calendarSettings = route.name === "Calendar" && getFocusedRouteNameFromRoute(route) === "CalendarSettings";
            return <RootHeader title={calendarSettings ? "Настройки календаря" : options.title ?? ""}
            onBack={calendarSettings ? () => {
              const key = navigation.getState().routes.find((item) => item.key === route.key)?.state?.key;
              if (key) navigation.dispatch({ ...StackActions.popToTop(), target: key });
            } : undefined}
            onOpenSettings={route.name === "Calendar"
              ? () => navigation.navigate("Calendar", { screen: "CalendarSettings" }) : undefined}
            collapsed={scrolled[route.name as keyof RootTabRoutes]} search={headerSearch(route.name as keyof RootTabRoutes)}
            onOpenNotifications={onOpenNotifications}
            onOpenMenu={() => setMenuVisible(true)} menuButtonRef={menuButtonRef} />;
          },
        }}
      >
        <Tabs.Screen name="Clients" options={{ title: rootTabs.Clients, tabBarLabel: rootTabs.Clients,
          tabBarAccessibilityLabel: activeCount ? `${rootTabs.Clients}, активных: ${activeCount}` : rootTabs.Clients,
          tabBarBadge: countBadge(activeCount) }}>
          {() => <HeaderScrollReporter value={reporters.Clients}>
            <HeaderSearchProvider value={searchContexts.Clients}>
              <ClientsNavigator onOpenCreate={onOpenCreate} onOpenClient={onOpenClient} repository={clients}
                readModel={clientLists.active} overviewSource={rosterOverview} />
            </HeaderSearchProvider>
          </HeaderScrollReporter>}
        </Tabs.Screen>
        <Tabs.Screen name="Calendar" options={{ title: rootTabs.Calendar, tabBarLabel: rootTabs.Calendar, tabBarAccessibilityLabel: rootTabs.Calendar }}>
          {() => <CalendarNavigator repository={calendar} participants={calendarParticipants}
            credit={calendarCredit} onCreateClientFromGuest={onCreateClientFromGuest} />}
        </Tabs.Screen>
        <Tabs.Screen name="Archive" options={{ title: rootTabs.Archive, tabBarLabel: rootTabs.Archive,
          tabBarAccessibilityLabel: archivedCount ? `${rootTabs.Archive}, клиентов в архиве: ${archivedCount}` : rootTabs.Archive,
          tabBarBadge: countBadge(archivedCount) }}>
          {() => <HeaderScrollReporter value={reporters.Archive}>
            <HeaderSearchProvider value={searchContexts.Archive}>
              <ArchiveNavigator repository={clients} readModel={clientLists.archived} />
            </HeaderSearchProvider>
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
