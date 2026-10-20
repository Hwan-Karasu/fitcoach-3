import { useCallback, useEffect, useState } from "react";
import { WeekNavigationProvider } from "../../shared/ui/components/public.ts";
import { useFocusEffect } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StyleSheet, Text, View } from "react-native";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";
import { ageOn, type ClientRecord, type ClientRepositoryPort, type ClientRosterPort } from "../../features/clients/public.ts";
import { localDateOf } from "../../features/measurements/public.ts";
import type { MeasurementRepositoryPort } from "../../features/measurements/public.ts";
import type { FoodCatalogPort, NutritionCalcPort, NutritionDiaryPort, NutritionTargetsPort, RecipeCatalogPort } from "../../features/nutrition/public.ts";
import { ClientQuestionnaireScreen, type QuestionnaireRepositoryPort } from "../../features/questionnaire/public.ts";
import { ExecutionDetailsScreen, ExerciseHistoryList, HistoryProgramScreen, MonthlyReportScreen, TrainingArchiveScreen, TrainingStatisticsScreen, retainHistoryView,
  retainStatsFilters, type ExerciseLookupPort,
  type ActiveWorkoutsPort, type RestTimersPort, type TrainingExecutionPort, type TrainingPlansRepositoryPort,
  type WeekCopyPort, type WeekSwapPort, type MesocycleSavePort, type MesocycleDeletePort, type ProgramDeletePort, type PlanOnlyDeletePort, type WorkoutSlot } from "../../features/training/public.ts";
import type { ExerciseCatalogPort } from "../../features/exercises/public.ts";
import { AppButton, LoadingState } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { HomeNavigator, NutritionNavigator, TrainingNavigator } from "./ClientPrimaryNavigators.tsx";
import { ClientHeader } from "./ClientHeader.tsx";
import { ScreenToneProvider } from "../../shared/ui/theme/ScreenTone.tsx";
import { MoreMenuScreen } from "./MoreMenuScreen.tsx";
import { moreDestinations, workspaceTabs } from "./routeCatalog.ts";
import { RootTabBar } from "./RootTabBar.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import type { TrainingHistoryPort } from "../../read-models/trainingHistory.ts";
import type { ClientBodyweightPort } from "../../read-models/clientBodyweight.ts";

type OpenWorkout = (slot: WorkoutSlot, options?: Readonly<{ returnToCaller?: boolean }>) => void;

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
  HistoryProgram: { programId: string };
  HistoryExecution: { sessionKey: string };
  Statistics: undefined;
  MonthlyReport: undefined;
};

const Tabs = createBottomTabNavigator<WorkspaceTabs>();
const MoreStack = createNativeStackNavigator<MoreRoutes>();

function MoreNavigator({ client, questionnaire, history, bodyweight, exerciseLookup, onClose, onOpenClients, onOpenExercise, onOpenWorkout }: Readonly<{
  client: ClientRecord; questionnaire: QuestionnaireRepositoryPort; onClose: () => void; onOpenClients: () => void;
  history: TrainingHistoryPort; bodyweight: ClientBodyweightPort; exerciseLookup: ExerciseLookupPort;
  onOpenExercise: (exerciseId: string) => void; onOpenWorkout: OpenWorkout;
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
      <MoreStack.Screen name="TrainingArchive" options={{ title: moreDestinations.TrainingArchive }}>
        {({ navigation }) => <TrainingArchiveScreen clientId={clientId} history={history}
          onOpenProgram={(programId) => navigation.navigate("HistoryProgram", { programId })}
          renderExercises={(query) => <ExerciseHistoryList clientId={clientId} history={history} exercises={exerciseLookup} query={query}
            onOpenExercise={onOpenExercise} />} />}
      </MoreStack.Screen>
      {/* Название программы — подзаголовок шапки (одна строка шапки); выбор мезоцикла не добавляет экран в стек. */}
      <MoreStack.Screen name="HistoryProgram" options={{ title: moreDestinations.TrainingArchive }}>
        {({ navigation, route }) => <HistoryProgramScreen clientId={clientId} programId={route.params.programId} history={history}
          onTitle={(title) => navigation.setOptions({ title })}
          onOpenExecution={(entry) => navigation.navigate("HistoryExecution", { sessionKey: entry.key })} />}
      </MoreStack.Screen>
      <MoreStack.Screen name="HistoryExecution" options={{ title: "Занятие" }}>
        {({ route }) => <ExecutionDetailsScreen clientId={clientId} sessionKey={route.params.sessionKey} history={history} exercises={exerciseLookup}
          onOpenExercise={onOpenExercise}
          onOpenInDiary={(entry) => onOpenWorkout({ clientId, programId: entry.programId, weekIndex: entry.weekIndex, plannedWorkoutId: entry.plannedWorkoutId },
            { returnToCaller: true })} />}
      </MoreStack.Screen>
      <MoreStack.Screen name="Statistics" options={{ title: moreDestinations.Statistics }}>
        {({ navigation }) => <TrainingStatisticsScreen clientId={clientId} history={history} bodyweight={bodyweight} exercises={exerciseLookup} onOpenExercise={onOpenExercise}
          onOpenWorkout={(slot) => onOpenWorkout(slot, { returnToCaller: true })} onOpenMonthlyReport={() => navigation.navigate("MonthlyReport")} />}
      </MoreStack.Screen>
      <MoreStack.Screen name="MonthlyReport" options={{ title: "Месячный отчёт" }}>
        {() => <MonthlyReportScreen clientId={clientId} history={history} bodyweight={bodyweight} exercises={exerciseLookup} onOpenWorkout={(slot) => onOpenWorkout(slot, { returnToCaller: true })} />}
      </MoreStack.Screen>
    </MoreStack.Navigator>
  );
}

export function ClientWorkspaceNavigator({ clientId, repository, accounting, measurements, nutrition, questionnaire, trainingPlans, trainingExecution, trainingHistory, clientBodyweight, restTimers, activeWorkouts, onOpenWorkout, onOpenClientPrograms, exercises, exerciseLookup, weekCopy, weekSwap, mesocycleSave, planDelete, onOpenEdit, onOpenAccounting,
  onOpenMeasurements, onClose, onOpenClients, onOpenExercise }: Readonly<{
  clientId: string;
  repository: ClientRepositoryPort & ClientRosterPort;
  accounting: AccountingRepositoryPort;
  measurements: MeasurementRepositoryPort;
  nutrition: Readonly<{ foods: FoodCatalogPort; recipes: RecipeCatalogPort; diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort }>;
  questionnaire: QuestionnaireRepositoryPort;
  trainingPlans: TrainingPlansRepositoryPort;
  trainingExecution: TrainingExecutionPort;
  /** §48.85: хронология занятий — архив, статистика, история упражнения. */
  trainingHistory: TrainingHistoryPort;
  /** §48.86.36: масса тела клиента для тоннажа. */
  clientBodyweight: ClientBodyweightPort;
  restTimers: RestTimersPort;
  activeWorkouts: ActiveWorkoutsPort;
  /** `returnToCaller` — «←» из открытой тренировки возвращает туда, откуда её открыли (история, статистика). */
  onOpenWorkout: OpenWorkout;
  /** UI-OWN-043: «назад» с программы другого участника группы — его карточка, список программ. */
  onOpenClientPrograms: (clientId: string) => void;
  exercises: ExerciseCatalogPort;
  exerciseLookup: ExerciseLookupPort;
  weekCopy: WeekCopyPort;
  weekSwap: WeekSwapPort;
  mesocycleSave: MesocycleSavePort;
  planDelete: MesocycleDeletePort & ProgramDeletePort & PlanOnlyDeletePort;
  onOpenEdit: (clientId: string) => void;
  onOpenAccounting: (clientId: string) => void;
  onOpenMeasurements: (clientId: string) => void;
  onClose: () => void;
  onOpenClients: () => void;
  onOpenExercise?: (exerciseId: string) => void;
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
  // Режим, фильтры и раскрытые карточки истории и статистики живут, пока открыта карточка клиента (в том числе тренировка, открытая поверх неё).
  useEffect(() => {
    const releaseHistory = retainHistoryView(clientId);
    const releaseStats = retainStatsFilters(clientId);
    return () => { releaseHistory(); releaseStats(); };
  }, [clientId]);
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

  /** Данные карточки для расчёта КБЖУ; возраст — из даты рождения на сегодня. */
  const calcBody = { sex: client.sex ?? null, age: ageOn(client.birthDate, localDateOf(new Date())), heightCm: client.heightCmX10 === null ? null : client.heightCmX10 / 10 };
  /** Пол и рост пишутся в карточку клиента (владелец — Clients) с CAS по revision; остальные поля карточки сохраняются как есть. */
  const updateCalcBody = async (patch: Readonly<{ sex: "MALE" | "FEMALE" | null; heightCm: number | null }>): Promise<void> => {
    const updated = await repository.update(client.id, client.revision, { displayName: client.displayName, contactPhone: client.contactPhone ?? undefined,
      contactEmail: client.contactEmail ?? undefined, birthDate: client.birthDate, heightCmX10: patch.heightCm === null ? null : Math.round(patch.heightCm * 10), sex: patch.sex, emoji: client.emoji });
    setSelection({ clientId, result: updated });
  };

  return (
    <View style={styles.root}>
      {loadErrorFor === clientId ? <Text accessibilityRole="alert"
        style={[styles.warning, { color: colors.danger }]}>
        Не удалось обновить данные клиента. Показана последняя загруженная версия.
      </Text> : null}
      {activityErrorFor === clientId ? <Text style={[styles.warning, { color: colors.danger }]}>
        Не удалось обновить «Недавно открытые»; карточка доступна.
      </Text> : null}
    <WeekNavigationProvider><ScreenToneProvider><Tabs.Navigator
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
      <Tabs.Screen name="Nutrition" options={{ tabBarLabel: workspaceTabs.Nutrition, tabBarAccessibilityLabel: workspaceTabs.Nutrition }}>
        {() => <NutritionNavigator clientId={client.id} clientName={client.displayName} clientEmoji={client.emoji} body={calcBody} onUpdateBody={updateCalcBody} foods={nutrition.foods} recipes={nutrition.recipes}
          diary={nutrition.diary} targets={nutrition.targets} calc={nutrition.calc} measurements={measurements} onExitClient={onClose} onOpenClients={onOpenClients} />}
      </Tabs.Screen>
      <Tabs.Screen name="Training" options={{ tabBarLabel: workspaceTabs.Training, tabBarAccessibilityLabel: workspaceTabs.Training}}>
        {() => <TrainingNavigator clientId={client.id} clientName={client.displayName} clientEmoji={client.emoji} repository={trainingPlans}
          execution={trainingExecution} restTimers={restTimers} activeWorkouts={activeWorkouts} onOpenWorkout={onOpenWorkout} onOpenClientPrograms={onOpenClientPrograms}
          listCandidates={listCandidates} onExitClient={onClose} onOpenClients={onOpenClients}
          exercises={exercises} exerciseLookup={exerciseLookup} weekCopy={weekCopy} weekSwap={weekSwap} mesocycleSave={mesocycleSave} planDelete={planDelete} onOpenExercise={onOpenExercise} />}
      </Tabs.Screen>
      <Tabs.Screen name="More" options={{ tabBarLabel: workspaceTabs.More, tabBarAccessibilityLabel: workspaceTabs.More}}>
        {() => <MoreNavigator client={client} questionnaire={questionnaire} onClose={onClose} onOpenClients={onOpenClients}
          history={trainingHistory} bodyweight={clientBodyweight} exerciseLookup={exerciseLookup}
          onOpenExercise={(exerciseId) => onOpenExercise?.(exerciseId)} onOpenWorkout={onOpenWorkout} />}
      </Tabs.Screen>
    </Tabs.Navigator></ScreenToneProvider></WeekNavigationProvider>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  warning: { paddingHorizontal: 16, paddingVertical: 6, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
