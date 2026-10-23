import { useEffect, useRef, useState } from "react";
import { NavigationContainer, StackActions, createNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ClientExerciseScreen, RestTimerDock, TrainingSettingsScreen } from "../../features/training/public.ts";
import { calendarEventTarget, timerTarget, type NotificationTarget } from "./notificationTarget.ts";
import { NotificationOpenHost } from "./NotificationOpenHost.tsx";
import { NotificationCenterScreen, NotificationSettingsScreen } from "../../features/notifications/public.ts";
import { NotificationsHost } from "./NotificationsHost.tsx";
import { SettingsPreview, ThemeCatalogPreview } from "../../features/settings/public.ts";
import { ClientRosterSettingsScreen } from "../../features/clients/public.ts";
import { AppointmentOutcomeDialog, CalendarUndoProvider, type GuestLinkRequest } from "../../features/calendar/public.ts";
import { ClientAccountingScreen } from "../../features/accounting/public.ts";
import { ClientMeasurementsScreen } from "../../features/measurements/public.ts";
import { QuestionnaireBuilderScreen } from "../../features/questionnaire/public.ts";
import { CustomExerciseEditorScreen, ExerciseDetailScreen, ExerciseLibraryScreen } from "../../features/exercises/public.ts";
import { useAppointmentOutcomeQueue } from "../bootstrap/useAppointmentOutcomeQueue.ts";
import { SettingsBinding } from "./SettingsBinding.tsx";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { WorkspaceRoutePreview } from "../../shared/ui/prototype/WorkspaceRoutePreview.tsx";
import { ClientWorkspaceNavigator } from "./ClientWorkspaceNavigator.tsx";
import { ClientEditorRoute } from "./ClientEditorRoute.tsx";
import type { ApplicationServices } from "../composition/createServices.ts";
import { ClientListController } from "../../read-models/ClientListController.ts";
import { createRosterOverviewSource } from "../../read-models/rosterOverview.ts";
import { homeSummaryRules } from "../../read-models/useClientHomeSummary.ts";
import type { RosterOverviewPort } from "../../features/clients/public.ts";
import { RootTabs } from "./RootTabs.tsx";
import { SqliteDiagnosticsScreen } from "./SqliteDiagnosticsScreen.tsx";
import { BottomDockLayoutProvider, ScreenHeader } from "../../shared/ui/components/public.ts";
import { DataReadNotice } from "../../shared/ui/components/DataReadNotice.tsx";
import { BackupScreen } from "./BackupScreen.tsx";
import type { ManualBackupPort, RestoreActionsPort } from "../../features/backup/public.ts";

type RootStackRoutes = {
  Root: undefined;
  Notifications: undefined;
  NotificationSettings: undefined;
  Settings: undefined;
  Backup: undefined;
  ClientRosterSettings: undefined;
  TrainingSettings: undefined;
  QuestionnaireBuilder: undefined;
  ExerciseCatalog: undefined;
  ExerciseDetail: { exerciseId: string };
  /** X02: упражнение в контексте клиента — обзор, история, прогресс. */
  ClientExercise: { clientId: string; exerciseId: string };
  ExerciseEditor: { exerciseId?: string; name?: string } | undefined;
  Appearance: undefined;
  WorkspaceDev: undefined;
  /** `screen`/`params` — сразу открыть тренировку клиента (быстрый переход между дневниками, §48.83). */
  ClientWorkspace: { clientId: string; screen?: "Training";
    params?: { screen: "TrainingWorkout"; params: { programId: string; weekIndex: number; workoutId: string; closeOnBack?: boolean; focusExerciseId?: string } }
      | { screen: "TrainingIndex" } };
  ClientAccounting: { clientId: string };
  ClientMeasurements: { clientId: string };
  ClientEditorDev: { clientId?: string; guestLink?: GuestLinkRequest } | undefined;
  SqliteDev: undefined;
};

const Stack = createNativeStackNavigator<RootStackRoutes>();
const navigationRef = createNavigationContainerRef<RootStackRoutes>();

/**
 * Переход по нажатию на уведомление, строку центра или панель таймера. Календарь — вкладка корня; «Тренировки» клиента и его тренировка —
 * экран клиента (тот же вызов, что у быстрого перехода между дневниками). Если тренировка уже открыта, ничего не меняется.
 */
function openTarget(target: NotificationTarget): void {
  if (!navigationRef.isReady()) return;
  if (target.kind === "CALENDAR") { navigationRef.navigate("Root", { screen: "Calendar" } as never); return; }
  const top = navigationRef.getRootState()?.routes.at(-1);
  // Уже внутри экрана клиента — заменяем его, а не добавляем: цепочка переходов с таймера не превращается в историю «как в браузере».
  // Из другого места (например, Календаря) сначала открываем список клиентов, чтобы «назад» привело к нему, как при обычном заходе.
  const inClient = top?.name === "ClientWorkspace";
  if (!inClient) navigationRef.navigate("Root", { screen: "Clients" } as never);
  const open = inClient ? StackActions.replace : StackActions.push;
  if (target.kind === "CLIENT_TRAINING") {
    navigationRef.dispatch(open("ClientWorkspace", { clientId: target.clientId, screen: "Training", params: { screen: "TrainingIndex" } }));
    return;
  }
  const current = navigationRef.getCurrentRoute() as { name: string; params?: { programId?: string; weekIndex?: number; workoutId?: string } } | undefined;
  const topParams = top?.params as { clientId?: string } | undefined;
  if (top?.name === "ClientWorkspace" && topParams?.clientId === target.clientId && current?.name === "TrainingWorkout"
    && current.params?.programId === target.programId && current.params.weekIndex === target.weekIndex && current.params.workoutId === target.plannedWorkoutId) return;
  // Полный путь клиент → программы → программа → тренировка, как при обычном заходе: «назад» ведёт к списку тренировок (программе),
  // затем к программам клиента и дальше к списку клиентов.
  navigationRef.dispatch(open("ClientWorkspace", { clientId: target.clientId, screen: "Training", params: { state: { routes: [
    { name: "TrainingIndex" },
    { name: "TrainingProgram", params: { programId: target.programId, weekIndex: target.weekIndex } },
    { name: "TrainingWorkout", params: { programId: target.programId, weekIndex: target.weekIndex, workoutId: target.plannedWorkoutId,
      ...(target.exerciseKey === null ? {} : { focusExerciseId: target.exerciseKey }) } },
  ] } } } as never));
}

function ShellNavigator({ services, clientLists, rosterOverview, manualBackup, restoreActions, initialBackup }: Readonly<{
  services: ApplicationServices; clientLists: ClientListController; rosterOverview: RosterOverviewPort; manualBackup: ManualBackupPort; restoreActions: RestoreActionsPort; initialBackup: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const developmentTools = services.developmentTools;
  return (
    <NavigationContainer ref={navigationRef} initialState={initialBackup ? { index: 1, routes: [{ name: "Root" }, { name: "Backup" }] } : undefined}>
      <Stack.Navigator
        screenOptions={{
          // Единая шапка-карточка одной высоты (UI-OWN-035).
          header: ({ navigation, options, back }) => <ScreenHeader title={options.title}
            onBack={back !== undefined ? () => navigation.goBack() : undefined} />,
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
              onOpenWorkspaceDev={developmentTools ? () => navigation.navigate("WorkspaceDev") : undefined}
              onOpenCreate={() => navigation.navigate("ClientEditorDev")}
              onOpenClient={(clientId) => navigation.navigate("ClientWorkspace", { clientId })}
              onOpenSqliteDev={developmentTools ? () => navigation.navigate("SqliteDev") : undefined}
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
          {({ navigation }) => <NotificationCenterScreen center={services.notifications} onOpenSettings={() => navigation.navigate("NotificationSettings")}
            onOpenEvent={(item) => openTarget(calendarEventTarget(item))} />}
        </Stack.Screen>
        <Stack.Screen name="NotificationSettings" options={{ title: "Настройки уведомлений" }}>
          {() => <NotificationSettingsScreen center={services.notifications} platform={services.notificationPlatform} onChanged={() => { services.notificationSync.run().catch(() => undefined); }} />}
        </Stack.Screen>
        <Stack.Screen name="Settings" options={{ title: "Настройки" }}>
          {({ navigation }) => (
            <SettingsPreview
              onOpenAppearance={() => navigation.navigate("Appearance")}
              onOpenNotificationSettings={() => navigation.navigate("NotificationSettings")}
              onOpenClientRosterSettings={() => navigation.navigate("ClientRosterSettings")}
              onOpenQuestionnaireBuilder={() => navigation.navigate("QuestionnaireBuilder")}
              onOpenExerciseCatalog={() => navigation.navigate("ExerciseCatalog")}
              onOpenTrainingSettings={() => navigation.navigate("TrainingSettings")}
              onOpenBackup={() => navigation.navigate("Backup")}
            />
          )}
        </Stack.Screen>
        <Stack.Screen name="Backup" options={{ title: "Резервные копии" }}>
          {() => <BackupScreen backup={manualBackup} restore={restoreActions} />}
        </Stack.Screen>
        <Stack.Screen name="TrainingSettings" options={{ title: "Тренировки" }}>
          {() => <TrainingSettingsScreen execution={services.trainingExecution} />}
        </Stack.Screen>
        <Stack.Screen name="ClientRosterSettings" options={{ title: "Список клиентов" }}>
          {() => <ClientRosterSettingsScreen repository={services.clients} />}
        </Stack.Screen>
        <Stack.Screen name="QuestionnaireBuilder" options={{ title: "Конструктор анкеты" }}>
          {() => <QuestionnaireBuilderScreen repository={services.questionnaire} />}
        </Stack.Screen>
        <Stack.Screen name="ExerciseCatalog" options={{ title: "Каталог упражнений" }}>
          {({ navigation }) => <ExerciseLibraryScreen repository={services.exercises}
            onOpen={(exerciseId) => navigation.navigate("ExerciseDetail", { exerciseId })}
            onCreate={(name) => navigation.navigate("ExerciseEditor", { name })} />}
        </Stack.Screen>
        <Stack.Screen name="ExerciseDetail" options={{ title: "Упражнение" }}>
          {({ navigation, route }) => <ExerciseDetailScreen exerciseId={route.params.exerciseId} repository={services.exercises}
            onEdit={(exerciseId) => navigation.navigate("ExerciseEditor", { exerciseId })}
            onArchived={() => navigation.goBack()} />}
        </Stack.Screen>
        <Stack.Screen name="ExerciseEditor" options={{ title: "Своё упражнение" }}>
          {({ navigation, route }) => <CustomExerciseEditorScreen exerciseId={route.params?.exerciseId}
            onCancel={() => navigation.goBack()}
            initialName={route.params?.name} repository={services.exercises}
            onSaved={(exerciseId) => route.params?.exerciseId !== undefined ? navigation.goBack()
              : navigation.replace("ExerciseDetail", { exerciseId })} />}
        </Stack.Screen>
        <Stack.Screen name="Appearance" options={{ headerShown: false }}>
          {({ navigation }) => <ThemeCatalogPreview onClose={() => navigation.goBack()} />}
        </Stack.Screen>
        {developmentTools ? <Stack.Screen name="WorkspaceDev" options={{ title: "Маршрут клиента · демо" }}>
          {() => <WorkspaceRoutePreview context="Маршрут без выбранного клиента" />}
        </Stack.Screen> : null}
        {/* Шапку клиента рисуют вкладки и стеки клиента (UI-OWN-035). */}
        <Stack.Screen name="ClientWorkspace" options={{ title: "Карточка клиента", headerShown: false }}>
          {({ navigation, route }) => <ClientWorkspaceNavigator
            clientId={route.params.clientId} repository={services.clients}
            accounting={services.accounting} measurements={services.measurements} nutrition={services.nutrition}
            trainingPlans={services.trainingPlans} trainingExecution={services.trainingExecution} trainingHistory={services.trainingHistory} clientBodyweight={services.clientBodyweight} restTimers={services.restTimers} activeWorkouts={services.activeWorkouts}
            onOpenWorkout={(slot, options) => navigation.push("ClientWorkspace", { clientId: slot.clientId, screen: "Training",
              params: { screen: "TrainingWorkout", params: { programId: slot.programId, weekIndex: slot.weekIndex,
                workoutId: slot.plannedWorkoutId, ...(options?.returnToCaller === true ? { closeOnBack: true } : {}) } } })}
            onOpenClientPrograms={(clientId) => navigation.replace("ClientWorkspace", { clientId, screen: "Training",
              params: { screen: "TrainingIndex" } })}
            exercises={services.exercises} exerciseLookup={services.exerciseLookup} weekCopy={services.weekCopy} weekSwap={services.weekSwap} mesocycleSave={services.mesocycleSave} planDelete={services.planDelete}
            onOpenEdit={(clientId) => navigation.navigate("ClientEditorDev", { clientId })}
            onOpenAccounting={(clientId) => navigation.navigate("ClientAccounting", { clientId })}
            onOpenMeasurements={(clientId) => navigation.navigate("ClientMeasurements", { clientId })}
            onClose={() => navigation.goBack()} onOpenClients={() => navigation.popTo("Root")}
            onOpenExercise={(exerciseId) => navigation.navigate("ClientExercise", { clientId: route.params.clientId, exerciseId })} />}
        </Stack.Screen>
        <Stack.Screen name="ClientExercise" options={{ title: "Упражнение" }}>
          {({ navigation, route }) => <ClientExerciseScreen clientId={route.params.clientId} exerciseId={route.params.exerciseId}
            history={services.trainingHistory} exercises={services.exerciseLookup}
            renderOverview={() => <ExerciseDetailScreen exerciseId={route.params.exerciseId} repository={services.exercises}
              onEdit={(exerciseId) => navigation.navigate("ExerciseEditor", { exerciseId })} onArchived={() => navigation.goBack()} />}
            onOpenWorkout={(target) => navigation.push("ClientWorkspace", { clientId: route.params.clientId, screen: "Training",
              params: { screen: "TrainingWorkout", params: { programId: target.programId, weekIndex: target.weekIndex,
                workoutId: target.plannedWorkoutId, closeOnBack: true } } })} />}
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
            clientId={route.params?.clientId} repository={services.clients} questionnaire={services.questionnaire} clientCard={services.clientCard} measurements={services.measurements}
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
        {developmentTools ? <Stack.Screen name="SqliteDev" options={{ title: "SQLite · диагностика" }}>
          {() => <SqliteDiagnosticsScreen runProbe={developmentTools.runSqliteProbe} />}
        </Stack.Screen> : null}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** Ended appointments without an outcome pop up over any screen (§48.35.3). */
function OutcomeQueueHost({ services }: Readonly<{ services: ApplicationServices }>) {
  const queue = useAppointmentOutcomeQueue(services.calendar, services.accounting);
  return <AppointmentOutcomeDialog items={queue.items} visible={queue.visible} onLater={queue.later}
    repository={services.calendar} participants={services.calendarParticipants} credit={services.accounting} />;
}

export function PrototypeShell({ services, workspaceId, manualBackup, restoreActions, initialBackup }: Readonly<{
  services: ApplicationServices; workspaceId: string; manualBackup: ManualBackupPort; restoreActions: RestoreActionsPort; initialBackup: boolean;
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
      <KeyboardProvider>
      <SettingsBinding settings={services.settings}>
        <DataReadNotice />
        <BottomDockLayoutProvider>
        <BottomSheetModalProvider>
        <CalendarUndoProvider repository={services.calendar}>
          <NotificationsHost center={services.notifications} calendar={services.calendar} sync={services.notificationSync}>
            <ShellNavigator services={services} clientLists={clientLists} rosterOverview={rosterOverview} manualBackup={manualBackup} restoreActions={restoreActions} initialBackup={initialBackup} />
          </NotificationsHost>
          <OutcomeQueueHost services={services} />
          <RestTimerDock timers={services.restTimers} onOpen={(timer) => openTarget(timerTarget(timer))} />
          <NotificationOpenHost navigationRef={navigationRef} onTarget={openTarget} />
        </CalendarUndoProvider>
        </BottomSheetModalProvider>
        </BottomDockLayoutProvider>
      </SettingsBinding>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
