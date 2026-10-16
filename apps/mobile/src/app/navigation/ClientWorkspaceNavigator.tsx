import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StyleSheet, Text, View } from "react-native";
import type { ClientRecord, ClientRepositoryPort, ClientRosterPort } from "../../features/clients/public.ts";
import { QuestionnairePreview } from "../../features/questionnaire/public.ts";
import { TrainingArchivePreview, TrainingStatisticsPreview } from "../../features/training/public.ts";
import { AppButton, LoadingState } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { HomeNavigator, NutritionNavigator, TrainingNavigator } from "./ClientPrimaryNavigators.tsx";
import { MoreMenuScreen } from "./MoreMenuScreen.tsx";
import { moreDestinations, workspaceTabs } from "./routeCatalog.ts";
import { TabGlyph } from "./TabGlyph.tsx";

type WorkspaceTabs = {
  Home: undefined;
  Nutrition: undefined;
  Training: undefined;
  More: undefined;
};

type MoreRoutes = {
  MoreIndex: undefined;
  Questionnaire: undefined;
  TrainingArchive: undefined;
  Statistics: undefined;
};

const Tabs = createBottomTabNavigator<WorkspaceTabs>();
const MoreStack = createNativeStackNavigator<MoreRoutes>();

function MoreNavigator() {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <MoreStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <MoreStack.Screen name="MoreIndex" options={{ headerShown: false }}>
        {({ navigation }) => (
          <MoreMenuScreen
            onOpenQuestionnaire={() => navigation.navigate("Questionnaire")}
            onOpenArchive={() => navigation.navigate("TrainingArchive")}
            onOpenStatistics={() => navigation.navigate("Statistics")}
          />
        )}
      </MoreStack.Screen>
      <MoreStack.Screen name="Questionnaire" component={QuestionnairePreview} options={{ title: moreDestinations.Questionnaire }} />
      <MoreStack.Screen name="TrainingArchive" component={TrainingArchivePreview} options={{ title: "Архив клиента" }} />
      <MoreStack.Screen name="Statistics" component={TrainingStatisticsPreview} options={{ title: moreDestinations.Statistics }} />
    </MoreStack.Navigator>
  );
}

export function ClientWorkspaceNavigator({ clientId, repository, onOpenEdit, onClose }: Readonly<{
  clientId: string;
  repository: ClientRepositoryPort & ClientRosterPort;
  onOpenEdit: (clientId: string) => void;
  onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [selection, setSelection] = useState<{
    clientId: string; result: ClientRecord | null | "ERROR";
  } | null>(null);
  const [activityErrorFor, setActivityErrorFor] = useState<string | null>(null);
  const [loadErrorFor, setLoadErrorFor] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const client = selection?.clientId === clientId ? selection.result : undefined;

  useFocusEffect(useCallback(() => {
    let active = true;
    void repository.get(clientId).then(async (row) => {
      if (!active) return;
      if (row === null || row.lifecycle !== "ACTIVE") {
        setSelection({ clientId, result: null });
        return;
      }
      setSelection({ clientId, result: row });
      setLoadErrorFor(null);
      setActivityErrorFor(null);
      try { await repository.recordRealOpen(clientId); }
      catch { if (active) setActivityErrorFor(clientId); }
    }).catch(() => {
      if (!active) return;
      setLoadErrorFor(clientId);
      setSelection((previous) => previous?.clientId === clientId
        && previous.result !== null && previous.result !== "ERROR"
        ? previous : { clientId, result: "ERROR" });
    });
    return () => { active = false; };
  }, [clientId, repository, retryKey]));

  if (client === undefined) return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
    <LoadingState label="Открываем клиента…" />
  </View>;
  if (client === null) return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
    <Text style={{ color: colors.textPrimary }}>Клиент не найден в активном рабочем пространстве.</Text>
    <AppButton label="Вернуться к списку" onPress={onClose} />
  </View>;
  if (client === "ERROR") return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
    <Text accessibilityRole="alert" style={{ color: colors.danger }}>Не удалось загрузить карточку клиента.</Text>
    <AppButton label="Повторить" onPress={() => setRetryKey((current) => current + 1)} />
    <AppButton variant="secondary" label="Вернуться к списку" onPress={onClose} />
  </View>;

  return (
    <View style={styles.root}>
      {loadErrorFor === clientId ? <Text accessibilityRole="alert"
        style={[styles.warning, { color: colors.danger }]}>
        Не удалось обновить данные клиента. Показана последняя загруженная версия.
      </Text> : null}
      {activityErrorFor === clientId ? <Text style={[styles.warning, { color: colors.danger }]}>
        Не удалось обновить «Недавно открытые»; карточка доступна.
      </Text> : null}
    <Tabs.Navigator
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accentInk,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
        tabBarItemStyle: { minHeight: 48 },
      }}
    >
      <Tabs.Screen name="Home" options={{ tabBarLabel: workspaceTabs.Home, tabBarAccessibilityLabel: workspaceTabs.Home, tabBarIcon: ({ color }) => <TabGlyph kind="home" color={color} /> }}>
        {() => <HomeNavigator client={client} onOpenEdit={() => onOpenEdit(client.id)}
          onArchive={async () => {
            try { await repository.setArchived(client.id, client.revision, true); }
            catch (error) { setRetryKey((current) => current + 1); throw error; }
            onClose();
          }} />}
      </Tabs.Screen>
      <Tabs.Screen name="Nutrition" component={NutritionNavigator} options={{ tabBarLabel: workspaceTabs.Nutrition, tabBarAccessibilityLabel: workspaceTabs.Nutrition, tabBarIcon: ({ color }) => <TabGlyph kind="nutrition" color={color} /> }} />
      <Tabs.Screen name="Training" component={TrainingNavigator} options={{ tabBarLabel: workspaceTabs.Training, tabBarAccessibilityLabel: workspaceTabs.Training, tabBarIcon: ({ color }) => <TabGlyph kind="training" color={color} /> }} />
      <Tabs.Screen name="More" component={MoreNavigator} options={{ tabBarLabel: workspaceTabs.More, tabBarAccessibilityLabel: workspaceTabs.More, tabBarIcon: ({ color }) => <TabGlyph kind="more" color={color} /> }} />
    </Tabs.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  warning: { paddingHorizontal: 16, paddingVertical: 6, fontSize: 12, lineHeight: 18 },
});
