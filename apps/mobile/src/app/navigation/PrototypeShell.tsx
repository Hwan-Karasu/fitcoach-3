import { useEffect, useRef, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NotificationsPreview, NotificationSettingsPreview } from "../../features/notifications/public.ts";
import { SettingsPreview, ThemeCatalogPreview } from "../../features/settings/public.ts";
import { ClientRosterSettingsScreen } from "../../features/clients/public.ts";
import { AppointmentOutcomeDialog, CalendarUndoProvider, type GuestLinkRequest } from "../../features/calendar/public.ts";
import { ClientAccountingScreen } from "../../features/accounting/public.ts";
import { ClientMeasurementsScreen } from "../../features/measurements/public.ts";
import { useAppointmentOutcomeQueue } from "../bootstrap/useAppointmentOutcomeQueue.ts";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { PrototypeThemeProvider, usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { WorkspaceRoutePreview } from "../../shared/ui/prototype/WorkspaceRoutePreview.tsx";
import { ClientWorkspaceNavigator } from "./ClientWorkspaceNavigator.tsx";
import { ClientEditorRoute } from "./ClientEditorRoute.tsx";
import type { DevServices } from "../composition/createDevServices.ts";
import { ClientListController } from "../../read-models/ClientListController.ts";
import { createRosterOverviewSource } from "../../read-models/rosterOverview.ts";
import { homeSummaryRules } from "../../read-models/useClientHomeSummary.ts";
import type { RosterOverviewPort } from "../../features/clients/public.ts";
import { RootTabs } from "./RootTabs.tsx";
import { SqliteDiagnosticsScreen } from "./SqliteDiagnosticsScreen.tsx";

type RootStackRoutes = {
  Root: undefined;
  Notifications: undefined;
  NotificationSettings: undefined;
  Settings: undefined;
  ClientRosterSettings: undefined;
  Appearance: undefined;
  WorkspaceDev: undefined;
  ClientWorkspace: { clientId: string };
  ClientAccounting: { clientId: string };
  ClientMeasurements: { clientId: string };
  ClientEditorDev: { clientId?: string; guestLink?: GuestLinkRequest } | undefined;
  SqliteDev: undefined;
};

const Stack = createNativeStackNavigator<RootStackRoutes>();

function ShellNavigator({ services, clientLists, rosterOverview }: Readonly<{
  services: DevServices; clientLists: ClientListController; rosterOverview: RosterOverviewPort;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontFamily: fonts.bold },
          contentStyle: { backgroundColor: colors.canvas },
        }}
      >
        <Stack.Screen name="Root" options={{ headerShown: false }}>
          {({ navigation }) => (
            <RootTabs
              onOpenSettings={() => navigation.navigate("Settings")}
              onOpenAppearance={() => navigation.navigate("Appearance")}
              onOpenNotificationSettings={() => navigation.navigate("NotificationSettings")}
              onOpenNotifications={() => navigation.navigate("Notifications")}
              onOpenWorkspaceDev={() => navigation.navigate("WorkspaceDev")}
              onOpenCreate={() => navigation.navigate("ClientEditorDev")}
              onOpenClient={(clientId) => navigation.navigate("ClientWorkspace", { clientId })}
              onOpenSqliteDev={() => navigation.navigate("SqliteDev")}
              clients={services.clients}
              clientLists={clientLists}
              rosterOverview={rosterOverview}
              calendar={services.calendar}
              calendarParticipants={services.calendarParticipants}
              calendarCredit={services.accounting}
              onCreateClientFromGuest={(guestLink) => navigation.navigate("ClientEditorDev", { guestLink })}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Notifications" options={{ title: "Центр уведомлений" }}>
          {({ navigation }) => <NotificationsPreview onOpenSettings={() => navigation.navigate("NotificationSettings")} />}
        </Stack.Screen>
        <Stack.Screen name="NotificationSettings" component={NotificationSettingsPreview} options={{ title: "Настройки уведомлений" }} />
        <Stack.Screen name="Settings" options={{ title: "Настройки" }}>
          {({ navigation }) => (
            <SettingsPreview
              onOpenAppearance={() => navigation.navigate("Appearance")}
              onOpenNotificationSettings={() => navigation.navigate("NotificationSettings")}
              onOpenClientRosterSettings={() => navigation.navigate("ClientRosterSettings")}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="ClientRosterSettings" options={{ title: "Список клиентов" }}>
          {() => <ClientRosterSettingsScreen repository={services.clients} />}
        </Stack.Screen>
        <Stack.Screen name="Appearance" options={{ headerShown: false }}>
          {({ navigation }) => <ThemeCatalogPreview onClose={() => navigation.goBack()} />}
        </Stack.Screen>
        <Stack.Screen name="WorkspaceDev" options={{ title: "Маршрут клиента · демо" }}>
          {() => <WorkspaceRoutePreview context="Маршрут без выбранного клиента" />}
        </Stack.Screen>
        <Stack.Screen name="ClientWorkspace" options={{ title: "Карточка клиента" }}>
          {({ navigation, route }) => <ClientWorkspaceNavigator
            clientId={route.params.clientId} repository={services.clients}
            accounting={services.accounting} measurements={services.measurements} questionnaire={services.questionnaire}
            onOpenEdit={(clientId) => navigation.navigate("ClientEditorDev", { clientId })}
            onOpenAccounting={(clientId) => navigation.navigate("ClientAccounting", { clientId })}
            onOpenMeasurements={(clientId) => navigation.navigate("ClientMeasurements", { clientId })}
            onClose={() => navigation.goBack()} />}
        </Stack.Screen>
        <Stack.Screen name="ClientAccounting" options={{ title: "Абонемент и оплата" }}>
          {({ route }) => <ClientAccountingScreen clientId={route.params.clientId}
            repository={services.accounting} listCreditSessionTypes={services.listCreditSessionTypes} />}
        </Stack.Screen>
        <Stack.Screen name="ClientMeasurements" options={{ title: "Замеры" }}>
          {({ route }) => <ClientMeasurementsScreen clientId={route.params.clientId} repository={services.measurements} />}
        </Stack.Screen>
        <Stack.Screen name="ClientEditorDev" options={{ headerShown: false, gestureEnabled: false }}>
          {({ navigation, route }) => <ClientEditorRoute
            clientId={route.params?.clientId} repository={services.clients} questionnaire={services.questionnaire}
            prefillName={route.params?.guestLink?.guestName}
            onCreated={async (client) => {
              const link = route.params?.guestLink;
              if (link === undefined) return;
              // The card is already saved; if the record changed meanwhile it stays a guest and can
              // be linked from the record with «Привязать к клиенту».
              await services.calendar.linkGuestToClient(link.appointmentId, null, client.id, link.includeSameName)
                .catch(() => undefined);
            }}
            onClose={() => navigation.goBack()} />}
        </Stack.Screen>
        <Stack.Screen name="SqliteDev" options={{ title: "SQLite · диагностика" }}>
          {() => <SqliteDiagnosticsScreen runProbe={services.runSqliteProbe} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** Ended appointments without an outcome pop up over any screen (§48.35.3). */
function OutcomeQueueHost({ services }: Readonly<{ services: DevServices }>) {
  const queue = useAppointmentOutcomeQueue(services.calendar, services.accounting);
  return <AppointmentOutcomeDialog items={queue.items} visible={queue.visible} onLater={queue.later}
    repository={services.calendar} participants={services.calendarParticipants} credit={services.accounting} />;
}

export function PrototypeShell({ services, workspaceId }: Readonly<{
  services: DevServices; workspaceId: string;
}>) {
  const [clientLists] = useState(() => new ClientListController(services.clients, workspaceId));
  const [rosterOverview] = useState(() => createRosterOverviewSource({ rules: homeSummaryRules,
    calendar: services.calendar, accounting: services.accounting, questionnaire: services.questionnaire }));
  const users = useRef(0);
  useEffect(() => {
    users.current += 1;
    // Fast Refresh/StrictMode run cleanup and setup back to back on the same instance; dispose only
    // when no setup follows, so children never subscribe to a disposed query.
    return () => {
      users.current -= 1;
      setTimeout(() => { if (users.current === 0) clientLists.dispose(); }, 0);
    };
  }, [clientLists]);
  return (
    <SafeAreaProvider>
      <PrototypeThemeProvider>
        <CalendarUndoProvider repository={services.calendar}>
          <ShellNavigator services={services} clientLists={clientLists} rosterOverview={rosterOverview} />
          <OutcomeQueueHost services={services} />
        </CalendarUndoProvider>
      </PrototypeThemeProvider>
    </SafeAreaProvider>
  );
}
