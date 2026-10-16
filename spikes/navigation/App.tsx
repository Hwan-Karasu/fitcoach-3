import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Button, Pressable, ScrollView, Text, View } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackScreenProps } from "@react-navigation/native-stack";
import { createBottomTabNavigator, type BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useNavigation } from "@react-navigation/native";
import type * as SQLite from "expo-sqlite";
import {
  DEFAULT_ROUTE,
  safeRouteFromNavigationState,
  type ClientSection,
  type RootTab,
  type SafeRoute,
} from "./src/safeRoute";
import {
  bumpDataRevision,
  openRouteStore,
  saveSafeRoute,
  saveStaleClientFixture,
  type RouteStore,
} from "./src/routeStore";

type RootParamList = {
  Trainer: undefined;
  Client: { clientId: string };
  Settings: undefined;
  Notifications: undefined;
};
type TrainerTabParamList = { Clients: undefined; Calendar: undefined; Archive: undefined };
type ClientStackParamList = {
  Main: undefined;
  Questionnaire: undefined;
  TrainingArchive: undefined;
  Statistics: undefined;
};
type ClientTabParamList = { Home: undefined; Nutrition: undefined; Training: undefined; More: undefined };

const RootStack = createNativeStackNavigator<RootParamList>();
const TrainerTabs = createBottomTabNavigator<TrainerTabParamList>();
const ClientStack = createNativeStackNavigator<ClientStackParamList>();
const ClientTabs = createBottomTabNavigator<ClientTabParamList>();
const navigationRef = createNavigationContainerRef<RootParamList>();
const ClientIdContext = createContext<string | null>(null);
const BootRouteContext = createContext<SafeRoute>(DEFAULT_ROUTE);
const validClientIds = new Set(["client-a", "client-b"]);

const surface = { flex: 1, padding: 20, gap: 14, backgroundColor: "#f5f7fa" } as const;
const heading = { fontSize: 23, fontWeight: "700", color: "#182230" } as const;

function useClientId(): string {
  const clientId = useContext(ClientIdContext);
  if (!clientId) throw new Error("Client context is missing");
  return clientId;
}

function HeaderActions({ onNotifications, onSettings }: { onNotifications: () => void; onSettings: () => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 14, marginRight: 8 }}>
      <Pressable accessibilityLabel="Открыть уведомления" onPress={onNotifications}>
        <Text style={{ color: "#1264aa", fontSize: 16 }}>Bell</Text>
      </Pressable>
      <Pressable accessibilityLabel="Открыть настройки" onPress={onSettings}>
        <Text style={{ color: "#1264aa", fontSize: 16 }}>Menu</Text>
      </Pressable>
    </View>
  );
}

function OpenClient({ clientId }: { clientId: string }) {
  const navigation = useNavigation<BottomTabNavigationProp<TrainerTabParamList>>();
  return <Button title={`Открыть ${clientId}`} onPress={() => navigation.getParent<NativeStackScreenProps<RootParamList>["navigation"]>()?.navigate("Client", { clientId })} />;
}

function TrainerClients() {
  return (
    <View style={surface}>
      <Text style={heading}>Клиенты · R08 spike</Text>
      <Text>Синтетические ID; данные FitCoach не используются.</Text>
      <OpenClient clientId="client-a" />
      <OpenClient clientId="client-b" />
    </View>
  );
}

function SimpleScreen({ title, description }: { title: string; description: string }) {
  return <View style={surface}><Text style={heading}>{title}</Text><Text>{description}</Text></View>;
}

function TrainerNavigator() {
  const bootRoute = useContext(BootRouteContext);
  const initialTab: RootTab = bootRoute.kind === "root" ? bootRoute.tab : "Clients";
  return (
    <TrainerTabs.Navigator initialRouteName={initialTab} screenOptions={{ headerShown: false }}>
      <TrainerTabs.Screen name="Clients" component={TrainerClients} options={{ title: "Клиенты" }} />
      <TrainerTabs.Screen name="Calendar" options={{ title: "Календарь" }}>
        {() => <SimpleScreen title="Календарь" description="Корневая вкладка; Android Back не должен листать вкладки." />}
      </TrainerTabs.Screen>
      <TrainerTabs.Screen name="Archive" options={{ title: "Архив" }}>
        {() => <SimpleScreen title="Архив клиентов" description="Третья и последняя корневая вкладка." />}
      </TrainerTabs.Screen>
    </TrainerTabs.Navigator>
  );
}

function ClientMain({ navigation, initialSection }: NativeStackScreenProps<ClientStackParamList, "Main"> & { initialSection: ClientSection }) {
  useEffect(() => {
    if (initialSection === "Questionnaire" || initialSection === "TrainingArchive" || initialSection === "Statistics") {
      navigation.navigate(initialSection);
    }
  }, [initialSection, navigation]);
  const initialTab = initialSection === "Home" || initialSection === "Nutrition" || initialSection === "Training"
    ? initialSection : "More";
  return (
    <ClientTabs.Navigator initialRouteName={initialTab} screenOptions={{ headerShown: false }}>
      <ClientTabs.Screen name="Home" options={{ title: "Главная" }}>
        {() => <ClientSectionScreen title="Главная" />}
      </ClientTabs.Screen>
      <ClientTabs.Screen name="Nutrition" options={{ title: "Питание" }}>
        {() => <ClientSectionScreen title="Питание" />}
      </ClientTabs.Screen>
      <ClientTabs.Screen name="Training" options={{ title: "Тренировки" }}>
        {() => <ClientSectionScreen title="Тренировки" />}
      </ClientTabs.Screen>
      <ClientTabs.Screen name="More" component={MoreScreen} options={{ title: "Ещё" }} />
    </ClientTabs.Navigator>
  );
}

function ClientSectionScreen({ title }: { title: string }) {
  const clientId = useClientId();
  return <SimpleScreen title={`${title} · ${clientId}`} description="Состояние клиента должно сохраняться при переключении и изменении data revision." />;
}

function MoreScreen() {
  const clientId = useClientId();
  const navigation = useNavigation<BottomTabNavigationProp<ClientTabParamList>>();
  const stack = navigation.getParent<NativeStackScreenProps<ClientStackParamList>["navigation"]>();
  return (
    <View style={surface}>
      <Text style={heading}>Ещё · {clientId}</Text>
      <Text>Три самостоятельных destinations, не три дополнительные нижние кнопки.</Text>
      <Button title="Анкета" onPress={() => stack?.navigate("Questionnaire")} />
      <Button title="Архив" onPress={() => stack?.navigate("TrainingArchive")} />
      <Button title="Статистика" onPress={() => stack?.navigate("Statistics")} />
    </View>
  );
}

function ClientHost({ route }: NativeStackScreenProps<RootParamList, "Client">) {
  const bootRoute = useContext(BootRouteContext);
  const clientId = route.params.clientId;
  const initialSection = bootRoute.kind === "client" && bootRoute.clientId === clientId
    ? bootRoute.section : "Home";
  return (
    <ClientIdContext.Provider value={clientId}>
      <ClientStack.Navigator initialRouteName="Main">
        <ClientStack.Screen name="Main" options={{ headerShown: false }}>
          {(props) => <ClientMain {...props} initialSection={initialSection} />}
        </ClientStack.Screen>
        <ClientStack.Screen name="Questionnaire" options={{ title: "Анкета" }}>
          {() => <ClientSectionScreen title="Анкета" />}
        </ClientStack.Screen>
        <ClientStack.Screen name="TrainingArchive" options={{ title: "Архив тренировок" }}>
          {() => <ClientSectionScreen title="Архив тренировок" />}
        </ClientStack.Screen>
        <ClientStack.Screen name="Statistics" options={{ title: "Статистика" }}>
          {() => <ClientSectionScreen title="Статистика" />}
        </ClientStack.Screen>
      </ClientStack.Navigator>
    </ClientIdContext.Provider>
  );
}

function Navigator({ route, onRouteChange }: { route: SafeRoute; onRouteChange: (state: unknown) => void }) {
  return (
    <BootRouteContext.Provider value={route}>
      <NavigationContainer
        ref={navigationRef}
        onReady={() => {
          if (route.kind === "client") navigationRef.navigate("Client", { clientId: route.clientId });
          if (route.kind === "settings") navigationRef.navigate("Settings");
          if (route.kind === "notifications") navigationRef.navigate("Notifications");
        }}
        onStateChange={onRouteChange}
      >
        <RootStack.Navigator initialRouteName="Trainer">
          <RootStack.Screen name="Trainer" component={TrainerNavigator} options={({ navigation }) => ({
            title: "FitCoach · R08", headerRight: () => <HeaderActions onNotifications={() => navigation.navigate("Notifications")} onSettings={() => navigation.navigate("Settings")} />,
          })} />
          <RootStack.Screen name="Client" component={ClientHost} options={({ navigation }) => ({
            title: "Клиент", headerRight: () => <HeaderActions onNotifications={() => navigation.navigate("Notifications")} onSettings={() => navigation.navigate("Settings")} />,
          })} />
          <RootStack.Screen name="Settings" options={{ title: "Настройки" }}>
            {() => <SimpleScreen title="Настройки" description="Отдельный root stack route, не четвёртая вкладка." />}
          </RootStack.Screen>
          <RootStack.Screen name="Notifications" options={{ title: "Уведомления" }}>
            {() => <SimpleScreen title="Центр уведомлений" description="Отдельный route по Bell; здесь не реализован домен уведомлений." />}
          </RootStack.Screen>
        </RootStack.Navigator>
      </NavigationContainer>
    </BootRouteContext.Provider>
  );
}

export default function App() {
  const [store, setStore] = useState<RouteStore | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [route, setRoute] = useState<SafeRoute>(DEFAULT_ROUTE);
  const [revision, setRevision] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const mountedId = useRef(Math.random().toString(36).slice(2, 9));
  const previousRoute = useRef<SafeRoute>(DEFAULT_ROUTE);
  const writeQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    let alive = true;
    void openRouteStore(validClientIds).then((opened) => {
      if (!alive) return;
      previousRoute.current = opened.savedRoute;
      setRoute(opened.savedRoute);
      setRevision(opened.dataRevision);
      setStore(opened);
    }).catch((cause: unknown) => {
      if (alive) setLoadError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { alive = false; };
  }, []);

  const report = useMemo(() => ({
    spike: "R08",
    bootCount: store?.bootCount ?? null,
    mountId: mountedId.current,
    dataRevision: revision,
    safeRoute: route,
    persistedSnapshotOnly: true,
  }), [store?.bootCount, revision, route]);

  if (loadError) return <Text selectable>R08 boot error: {loadError}</Text>;
  if (!store) return <ActivityIndicator style={{ flex: 1 }} size="large" />;

  const onRouteChange = (state: unknown) => {
    const next = safeRouteFromNavigationState(state, validClientIds, previousRoute.current);
    previousRoute.current = next;
    setRoute(next);
    writeQueue.current = writeQueue.current.then(() => saveSafeRoute(store.database, next)).catch((cause: unknown) => {
      setActionMessage(`Route save failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
  };

  const incrementRevision = async (database: SQLite.SQLiteDatabase) => {
    try {
      const next = await bumpDataRevision(database);
      setRevision(next);
      setActionMessage(`Data revision ${next}; navigator mount ID must stay unchanged.`);
    } catch (cause) {
      setActionMessage(`Revision failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <Navigator route={store.savedRoute} onRouteChange={onRouteChange} />
      <View style={{ padding: 10, backgroundColor: "#e9eef6", gap: 4 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
          <Button title="Revision +1" onPress={() => void incrementRevision(store.database)} />
          <Button title="Stale fixture" onPress={() => void saveStaleClientFixture(store.database).then(() => setActionMessage("Stale route saved; restart Expo Go without navigation."))} />
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
          <Button title="Settings test" onPress={() => navigationRef.navigate("Settings")} />
          <Button title="Bell test" onPress={() => navigationRef.navigate("Notifications")} />
        </View>
        {actionMessage ? <Text>{actionMessage}</Text> : null}
        <ScrollView style={{ maxHeight: 76 }}>
          <Text selectable accessibilityLabel="R08 Report">{JSON.stringify(report)}</Text>
        </ScrollView>
      </View>
    </View>
  );
}
