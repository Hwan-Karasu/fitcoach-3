import { useCallback, useState } from "react";
import { WeekNavigationProvider } from "../../shared/ui/components/public.ts";
import { useFocusEffect } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StyleSheet, Text, View } from "react-native";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";
import type { ClientRecord, ClientRepositoryPort, ClientRosterPort } from "../../features/clients/public.ts";
import type { MeasurementRepositoryPort } from "../../features/measurements/public.ts";
import { ClientQuestionnaireScreen, type QuestionnaireRepositoryPort } from "../../features/questionnaire/public.ts";
import { TrainingArchivePreview, TrainingStatisticsPreview, type ExerciseLookupPort,
  type ActiveWorkoutsPort, type RestTimersPort, type TrainingExecutionPort, type TrainingPlansRepositoryPort,
  type WeekCopyPort, type WeekSwapPort, type WorkoutSlot } from "../../features/training/public.ts";
import type { ExerciseCatalogPort } from "../../features/exercises/public.ts";
import { AppButton, LoadingState } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { HomeNavigator, NutritionNavigator, TrainingNavigator } from "./ClientPrimaryNavigators.tsx";
import { ClientHeader } from "./ClientHeader.tsx";
import { MoreMenuScreen } from "./MoreMenuScreen.tsx";
import { moreDestinations, workspaceTabs } from "./routeCatalog.ts";
import { RootTabBar } from "./RootTabBar.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

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

function MoreNavigator({ client, questionnaire, onClose, onOpenClients }: Readonly<{
  client: ClientRecord; questionnaire: QuestionnaireRepositoryPort; onClose: () => void; onOpenClients: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const clientId = client.id;
  return (
    <MoreStack.Navigator
      screenOptions={{
        contentStyle: { backgroundColor: palette.tokens.canvas },
        // Шапка клиента (UI-OWN-035): подзаголовок — раздел; «←» — назад по стеку или из клиента.
        header: ({ navigation, options, back }) => <ClientHeader client={client} subtitle={options.title ?? workspaceTabs.More}
          onBack={back !== undefined ? () => navigation.goBack() : onClose} onClients={onOpenClients} />,
      }}
    >
      <MoreStack.Screen name="MoreIndex" options={{ title: workspaceTabs.More }}>
        {({ navigation }) => (
          <MoreMenuScreen
            onOpenQuestionnaire={() => navigation.navigate("Questionnaire")}
            onOpenArchive={() => navigation.navigate("TrainingArchive")}
            onOpenStatistics={() => navigation.navigate("Statistics")}
          />
        )}
      </MoreStack.Screen>
      <MoreStack.Screen name="Questionnaire" options={{ title: moreDestinations.Questionnaire }}>
        {() => <ClientQuestionnaireScreen clientId={clientId} repository={questionnaire} />}
      </MoreStack.Screen>
      <MoreStack.Screen name="TrainingArchive" component={TrainingArchivePreview} options={{ title: "Архив клиента" }} />
      <MoreStack.Screen name="Statistics" component={TrainingStatisticsPreview} options={{ title: moreDestinations.Statistics }} />
    </MoreStack.Navigator>
  );
}

export function ClientWorkspaceNavigator({ clientId, repository, accounting, measurements, questionnaire, trainingPlans, trainingExecution, restTimers, activeWorkouts, onOpenWorkout, exercises, exerciseLookup, weekCopy, weekSwap, onOpenEdit, onOpenAccounting,
  onOpenMeasurements, onClose, onOpenClients }: Readonly<{
  clientId: string;
  repository: ClientRepositoryPort & ClientRosterPort;
  accounting: AccountingRepositoryPort;
  measurements: MeasurementRepositoryPort;
  questionnaire: QuestionnaireRepositoryPort;
  trainingPlans: TrainingPlansRepositoryPort;
  trainingExecution: TrainingExecutionPort;
  restTimers: RestTimersPort;
  activeWorkouts: ActiveWorkoutsPort;
  onOpenWorkout: (slot: WorkoutSlot) => void;
  exercises: ExerciseCatalogPort;
  exerciseLookup: ExerciseLookupPort;
  weekCopy: WeekCopyPort;
  weekSwap: WeekSwapPort;
  onOpenEdit: (clientId: string) => void;
  onOpenAccounting: (clientId: string) => void;
  onOpenMeasurements: (clientId: string) => void;
  onClose: () => void;
  onOpenClients: () => void;
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
  // Участники программ — только поля отображения активных клиентов (владелец Clients).
  const listCandidates = useCallback(async () => (await repository.listRoster("ACTIVE"))
    .map((row) => ({ id: row.id, displayName: row.displayName })), [repository]);

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
    <WeekNavigationProvider><Tabs.Navigator
      backBehavior="history"
      tabBar={(props) => <RootTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.canvas } }}
    >
      <Tabs.Screen name="Home" options={{ tabBarLabel: workspaceTabs.Home, tabBarAccessibilityLabel: workspaceTabs.Home, headerShown: true,
        header: () => <ClientHeader client={client} subtitle={workspaceTabs.Home} onBack={onClose} onClients={onOpenClients} /> }}>
        {() => <HomeNavigator client={client} accounting={accounting} measurements={measurements}
          onOpenEdit={() => onOpenEdit(client.id)}
          onOpenAccounting={() => onOpenAccounting(client.id)}
          onOpenMeasurements={() => onOpenMeasurements(client.id)}
          onArchive={async () => {
            try { await repository.setArchived(client.id, client.revision, true); }
            catch (error) { setRetryKey((current) => current + 1); throw error; }
            onClose();
          }} />}
      </Tabs.Screen>
      <Tabs.Screen name="Nutrition" component={NutritionNavigator} options={{ tabBarLabel: workspaceTabs.Nutrition,
        tabBarAccessibilityLabel: workspaceTabs.Nutrition, headerShown: true,
        header: () => <ClientHeader client={client} subtitle={workspaceTabs.Nutrition} onBack={onClose} onClients={onOpenClients} /> }} />
      <Tabs.Screen name="Training" options={{ tabBarLabel: workspaceTabs.Training, tabBarAccessibilityLabel: workspaceTabs.Training}}>
        {() => <TrainingNavigator clientId={client.id} clientName={client.displayName} clientEmoji={client.emoji} repository={trainingPlans}
          execution={trainingExecution} restTimers={restTimers} activeWorkouts={activeWorkouts} onOpenWorkout={onOpenWorkout}
          listCandidates={listCandidates} onExitClient={onClose} onOpenClients={onOpenClients}
          exercises={exercises} exerciseLookup={exerciseLookup} weekCopy={weekCopy} weekSwap={weekSwap} />}
      </Tabs.Screen>
      <Tabs.Screen name="More" options={{ tabBarLabel: workspaceTabs.More, tabBarAccessibilityLabel: workspaceTabs.More}}>
        {() => <MoreNavigator client={client} questionnaire={questionnaire} onClose={onClose} onOpenClients={onOpenClients} />}
      </Tabs.Screen>
    </Tabs.Navigator></WeekNavigationProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  warning: { paddingHorizontal: 16, paddingVertical: 6, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
});
