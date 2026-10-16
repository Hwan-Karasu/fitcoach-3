import { useEffect, useState } from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NotificationsPreview, NotificationSettingsPreview } from "../../features/notifications/public.ts";
import { SettingsPreview, ThemeCatalogPreview } from "../../features/settings/public.ts";
import { ClientRosterSettingsScreen } from "../../features/clients/public.ts";
import { PrototypeThemeProvider, usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { WorkspaceRoutePreview } from "../../shared/ui/prototype/WorkspaceRoutePreview.tsx";
import { ClientWorkspaceNavigator } from "./ClientWorkspaceNavigator.tsx";
import { ClientEditorRoute } from "./ClientEditorRoute.tsx";
import type { DevServices } from "../composition/createDevServices.ts";
import { ClientListController } from "../../read-models/ClientListController.ts";
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
  ClientEditorDev: { clientId: string } | undefined;
  SqliteDev: undefined;
};

const Stack = createNativeStackNavigator<RootStackRoutes>();

function ShellNavigator({ services, clientLists }: Readonly<{
  services: DevServices; clientLists: ClientListController;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: "700" },
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
              onOpenEdit={(clientId) => navigation.navigate("ClientEditorDev", { clientId })}
              onOpenClient={(clientId) => navigation.navigate("ClientWorkspace", { clientId })}
              onOpenSqliteDev={() => navigation.navigate("SqliteDev")}
              clients={services.clients}
              clientLists={clientLists}
              calendar={services.calendar}
              calendarParticipants={services.calendarParticipants}
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
            onOpenEdit={(clientId) => navigation.navigate("ClientEditorDev", { clientId })}
            onClose={() => navigation.goBack()} />}
        </Stack.Screen>
        <Stack.Screen name="ClientEditorDev" options={{ headerShown: false, gestureEnabled: false }}>
          {({ navigation, route }) => <ClientEditorRoute
            clientId={route.params?.clientId} repository={services.clients}
            onClose={() => navigation.goBack()} />}
        </Stack.Screen>
        <Stack.Screen name="SqliteDev" options={{ title: "SQLite · диагностика" }}>
          {() => <SqliteDiagnosticsScreen runProbe={services.runSqliteProbe} />}
        </Stack.Screen>
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export function PrototypeShell({ services, workspaceId }: Readonly<{
  services: DevServices; workspaceId: string;
}>) {
  // Created and disposed by the same effect, so Fast Refresh/StrictMode re-runs get a live instance.
  const [clientLists, setClientLists] = useState<ClientListController | null>(null);
  useEffect(() => {
    const controller = new ClientListController(services.clients, workspaceId);
    setClientLists(controller);
    return () => controller.dispose();
  }, [services.clients, workspaceId]);
  if (clientLists === null) return null;
  return (
    <SafeAreaProvider>
      <PrototypeThemeProvider>
        <ShellNavigator services={services} clientLists={clientLists} />
      </PrototypeThemeProvider>
    </SafeAreaProvider>
  );
}
