import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";
import { ClientHomePreview, type ClientRecord } from "../../features/clients/public.ts";
import { localDateOf, parseValueX10, type MeasurementRepositoryPort } from "../../features/measurements/public.ts";
import { useClientHomeSummary } from "../../read-models/useClientHomeSummary.ts";
import { NutritionWorkspacePreview } from "../../features/nutrition/public.ts";
import { CreateProgramScreen, MesocycleCreatorScreen, ProgramLibraryScreen, ProgramModeChooserScreen, ProgramScreen, SimpleProgramBuilderScreen,
  WeekEditorScreen, SimpleWorkoutEditorScreen, type PickedExercise, type WeekCopyPort,
  type ExerciseLookupPort, type ProgramKind, type TrainingParticipantCandidate,
  type TrainingPlansRepositoryPort, ProgramWeeksPanel, WorkoutScreen, type ActiveWorkoutsPort, type RestTimersPort, type TrainingExecutionPort,
  type WorkoutSlot } from "../../features/training/public.ts";
import { CustomExerciseEditorScreen, ExerciseLibraryScreen, type ExerciseCatalogPort } from "../../features/exercises/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { TrainingHeader } from "./TrainingHeader.tsx";

type HomeRoutes = { HomeIndex: undefined };
type NutritionRoutes = { NutritionIndex: undefined };
type TrainingRoutes = {
  TrainingIndex: undefined;
  TrainingChooser: undefined;
  TrainingCreate: { kind: ProgramKind };
  TrainingProgram: { programId: string; weekIndex?: number; mesocycleId?: string };
  TrainingBuilder: { programId?: string; picked?: PickedExercise } | undefined;
  TrainingMesocycle: { programId: string; picked?: PickedExercise };
  TrainingWeek: { programId: string; mesocycleId: string; weekIndex: number; picked?: PickedExercise };
  TrainingSimpleWorkout: { programId: string; weekIndex: number; workoutId: string; picked?: PickedExercise };
  /** Каталог для выбора упражнения; результат возвращается на экран `returnTo` с теми же параметрами. */
  TrainingPickExercise: { workoutId: string; replace?: string; returnTo: PickReturn };
  TrainingCreateExercise: { initialName: string; pick: TrainingRoutes["TrainingPickExercise"] };
  TrainingWorkout: { programId: string; weekIndex: number; workoutId: string; mesocycleId?: string };
};

type PickReturn =
  | Readonly<{ name: "TrainingBuilder"; params: { programId?: string } }>
  | Readonly<{ name: "TrainingMesocycle"; params: { programId: string } }>
  | Readonly<{ name: "TrainingWeek"; params: { programId: string; mesocycleId: string; weekIndex: number } }>
  | Readonly<{ name: "TrainingSimpleWorkout"; params: { programId: string; weekIndex: number; workoutId: string } }>;

const trainingTitles: Readonly<Record<keyof TrainingRoutes, string>> = {
  TrainingIndex: "Программы", TrainingChooser: "Новая программа", TrainingCreate: "Создание программы",
  TrainingProgram: "Программа", TrainingBuilder: "Простой конструктор", TrainingMesocycle: "Новый мезоцикл",
  TrainingWeek: "Редактирование недели", TrainingPickExercise: "Выбор упражнения", TrainingWorkout: "Дневник тренировки",
  TrainingCreateExercise: "Своё упражнение",
  TrainingSimpleWorkout: "План тренировки",
};

const HomeStack = createNativeStackNavigator<HomeRoutes>();
const NutritionStack = createNativeStackNavigator<NutritionRoutes>();
const TrainingStack = createNativeStackNavigator<TrainingRoutes>();

type HomeProps = Readonly<{
  client: ClientRecord; accounting: AccountingRepositoryPort; measurements: MeasurementRepositoryPort;
  onOpenEdit: () => void; onOpenAccounting: () => void; onOpenMeasurements: () => void;
  onArchive: () => Promise<void>;
}>;

/** Home composes owners' read projections; the weight entry goes to the Measurements owner. */
function HomeIndexRoute({ client, accounting, measurements, onOpenEdit, onOpenAccounting, onOpenMeasurements,
  onArchive }: HomeProps) {
  const summary = useClientHomeSummary(client.id, accounting, measurements);
  const recordWeight = async (text: string): Promise<string | null> => {
    const valueX10 = parseValueX10(text);
    if (valueX10 === null) return "Введите вес, например 80,1.";
    const now = new Date();
    try {
      await measurements.record(client.id, { type: "WEIGHT", valueX10, localDate: localDateOf(now),
        localMinute: now.getHours() * 60 + now.getMinutes() }, now);
      return null;
    } catch (error) {
      return error instanceof Error && error.message === "MEASUREMENT_VALUE_INVALID"
        ? "Вес вне допустимого диапазона (20–400 кг)." : "Не удалось записать вес. Замеры не изменены.";
    }
  };
  return <ClientHomePreview client={client} summary={summary} onEdit={onOpenEdit} onOpenAccounting={onOpenAccounting}
    onOpenMeasurements={onOpenMeasurements} onRecordWeight={recordWeight} onArchive={onArchive} />;
}

export function HomeNavigator(props: HomeProps) {
  const { palette } = usePrototypeTheme();
  return (
    <HomeStack.Navigator screenOptions={{ contentStyle: { backgroundColor: palette.tokens.canvas } }}>
      <HomeStack.Screen name="HomeIndex" options={{ headerShown: false }}>
        {() => <HomeIndexRoute {...props} />}
      </HomeStack.Screen>
    </HomeStack.Navigator>
  );
}

export function NutritionNavigator() {
  const { palette } = usePrototypeTheme();
  return (
    <NutritionStack.Navigator screenOptions={{ contentStyle: { backgroundColor: palette.tokens.canvas } }}>
      <NutritionStack.Screen name="NutritionIndex" component={NutritionWorkspacePreview} options={{ headerShown: false }} />
    </NutritionStack.Navigator>
  );
}

/**
 * §48.4 вкладка «Тренировки»: список программ → (выбор конструктора → создание) → программа.
 * Стек не сбрасывается при смене вкладок; после создания в стеке «список → программа».
 * Шапка — общая строка карточки клиента (UI-OWN-001), назад — системной кнопкой.
 */
export function TrainingNavigator({ clientId, clientName, repository, execution, restTimers, activeWorkouts, onOpenWorkout,
  listCandidates, exercises, exerciseLookup, weekCopy, onExitClient, onOpenClients }: Readonly<{
  clientId: string;
  clientName: string;
  repository: TrainingPlansRepositoryPort;
  execution: TrainingExecutionPort;
  restTimers: RestTimersPort;
  activeWorkouts: ActiveWorkoutsPort;
  onOpenWorkout: (slot: WorkoutSlot) => void;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>;
  exercises: ExerciseCatalogPort;
  exerciseLookup: ExerciseLookupPort;
  weekCopy: WeekCopyPort;
  onExitClient: () => void;
  onOpenClients: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  // Простая программа создаётся сразу в конструкторе; расширенная — пока через название и участников.
  const createRoute = (kind: ProgramKind) => kind === "SIMPLE" ? { name: "TrainingBuilder" as const, params: {} }
    : { name: "TrainingCreate" as const, params: { kind } };
  return (
    <TrainingStack.Navigator initialRouteName="TrainingIndex" screenOptions={({ navigation, route }) => ({
      contentStyle: { backgroundColor: palette.tokens.canvas },
      header: () => <TrainingHeader title={trainingTitles[route.name]} clientName={clientName}
        onClients={onOpenClients} onBack={() => {
          if (route.name === "TrainingWorkout") {
            const params = route.params as TrainingRoutes["TrainingWorkout"];
            navigation.popTo("TrainingProgram", { programId: params.programId, weekIndex: params.weekIndex, mesocycleId: params.mesocycleId });
          } else if (route.name === "TrainingProgram") navigation.popTo("TrainingIndex");
          else if (route.name === "TrainingIndex") onExitClient();
          else navigation.goBack();
        }} />,
    })}>
      <TrainingStack.Screen name="TrainingIndex">
        {({ navigation }) => <ProgramLibraryScreen clientId={clientId} repository={repository}
          onChoose={(kind) => { const route = createRoute(kind); navigation.navigate(route.name, route.params as never); }}
          onCreate={() => navigation.navigate("TrainingChooser")}
          onOpenProgram={(programId) => navigation.navigate("TrainingProgram", { programId })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingChooser">
        {({ navigation }) => <ProgramModeChooserScreen onChoose={(kind) => { const route = createRoute(kind); navigation.navigate(route.name, route.params as never); }} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingCreate">
        {({ navigation, route }) => <CreateProgramScreen clientId={clientId} kind={route.params.kind} repository={repository}
          listCandidates={listCandidates} onCancel={() => navigation.goBack()}
          onCreated={(programId) => navigation.reset({ index: 1,
            routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId } }] })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingProgram">
        {({ navigation, route }) => <ProgramScreen clientId={clientId} programId={route.params.programId}
          requestedWeek={route.params.weekIndex} requestedMesocycle={route.params.mesocycleId}
          repository={repository} listCandidates={listCandidates} exercises={exerciseLookup} weekCopy={weekCopy}
          renderWeeks={(view) => <ProgramWeeksPanel key={view.key} clientId={clientId} programId={route.params.programId} weeks={view.weeks}
            renderWeekActions={view.weekActions} execution={execution} selectedWeek={view.selectedWeek} onSelectWeek={view.onSelectWeek}
            onOpenWorkout={(weekIndex, workoutId) => navigation.navigate("TrainingWorkout", { programId: route.params.programId, weekIndex, workoutId,
              ...(view.key === "simple" ? {} : { mesocycleId: view.key }) })} />}
          onEditStructure={() => navigation.navigate("TrainingBuilder", { programId: route.params.programId })}
          onAddMesocycle={() => navigation.navigate("TrainingMesocycle", { programId: route.params.programId })}
          onEditWeek={(mesocycleId, weekIndex) => navigation.navigate("TrainingWeek", { programId: route.params.programId, mesocycleId, weekIndex })}
          onArchived={() => navigation.popTo("TrainingIndex")} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingBuilder">
        {({ navigation, route }) => <SimpleProgramBuilderScreen clientId={clientId} programId={route.params?.programId ?? null}
          onCancel={() => navigation.goBack()}
          repository={repository} exercises={exerciseLookup} picked={route.params?.picked ?? null}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId,
            ...(replace === undefined ? {} : { replace }),
            returnTo: { name: "TrainingBuilder", params: { ...(route.params?.programId === undefined ? {} : { programId: route.params.programId }) } } })}
          onSaved={(programId) => navigation.reset({ index: 1,
            routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId } }] })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingPickExercise">
        {({ navigation, route }) => <ExerciseLibraryScreen repository={exercises} picking
          onCreate={(initialName) => navigation.navigate("TrainingCreateExercise", { initialName, pick: route.params })}
          onOpen={(exerciseId) => {
            const picked: PickedExercise = { token: `${Date.now()}`, workoutId: route.params.workoutId, exerciseId,
              ...(route.params.replace === undefined ? {} : { replace: route.params.replace }) };
            const back = route.params.returnTo;
            if (back.name === "TrainingBuilder") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingMesocycle") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingWeek") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
          }} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingCreateExercise">
        {({ navigation, route }) => <CustomExerciseEditorScreen repository={exercises} initialName={route.params.initialName}
          onCancel={() => navigation.goBack()} onSaved={(exerciseId) => {
            const source = route.params.pick;
            const picked: PickedExercise = { token: `${Date.now()}`, workoutId: source.workoutId, exerciseId,
              ...(source.replace === undefined ? {} : { replace: source.replace }) };
            const back = source.returnTo;
            if (back.name === "TrainingBuilder") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingMesocycle") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingWeek") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
          }} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingMesocycle">
        {({ navigation, route }) => <MesocycleCreatorScreen clientId={clientId} programId={route.params.programId}
          onCancel={() => navigation.goBack()}
          repository={repository} exercises={exerciseLookup} listCandidates={listCandidates} picked={route.params.picked ?? null}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId,
            ...(replace === undefined ? {} : { replace }),
            returnTo: { name: "TrainingMesocycle", params: { programId: route.params.programId } } })}
          onCreated={() => navigation.popTo("TrainingProgram", { programId: route.params.programId })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingWeek">
        {({ navigation, route }) => <WeekEditorScreen clientId={clientId} programId={route.params.programId}
          onCancel={() => navigation.goBack()}
          mesocycleId={route.params.mesocycleId} weekIndex={route.params.weekIndex}
          repository={repository} exercises={exerciseLookup} listCandidates={listCandidates} picked={route.params.picked ?? null}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId,
            ...(replace === undefined ? {} : { replace }),
            returnTo: { name: "TrainingWeek", params: { programId: route.params.programId, mesocycleId: route.params.mesocycleId,
              weekIndex: route.params.weekIndex } } })}
          onSaved={() => navigation.goBack()} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingSimpleWorkout">
        {({ navigation, route }) => <SimpleWorkoutEditorScreen clientId={clientId} clientName={clientName}
          programId={route.params.programId} weekIndex={route.params.weekIndex} workoutId={route.params.workoutId}
          repository={repository} exercises={exerciseLookup} picked={route.params.picked ?? null}
          onCancel={() => navigation.goBack()} onSaved={() => navigation.goBack()}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId,
            ...(replace === undefined ? {} : { replace }), returnTo: { name: "TrainingSimpleWorkout",
              params: { programId: route.params.programId, weekIndex: route.params.weekIndex, workoutId: route.params.workoutId } } })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingWorkout">
        {({ route, navigation }) => <WorkoutScreen slot={{ clientId, programId: route.params.programId, weekIndex: route.params.weekIndex,
          plannedWorkoutId: route.params.workoutId }} clientName={clientName} plans={repository} execution={execution}
          restTimers={restTimers} activeWorkouts={activeWorkouts} onOpenWorkout={onOpenWorkout} exercises={exerciseLookup}
          onEditWeek={(mesocycleId) => {
            if (mesocycleId === null) navigation.navigate("TrainingSimpleWorkout", { programId: route.params.programId,
              workoutId: route.params.workoutId, weekIndex: route.params.weekIndex });
            else navigation.navigate("TrainingWeek", { programId: route.params.programId, mesocycleId, weekIndex: route.params.weekIndex });
          }}
          onChangeWeek={(weekIndex, workoutId, mesocycleId) => {
            const context = { programId: route.params.programId, weekIndex, ...(mesocycleId === null ? {} : { mesocycleId }) };
            if (workoutId === null) navigation.popTo("TrainingProgram", context);
            // Тот же экран с другими параметрами: без анимации перехода и без пересоздания дневника.
            else navigation.setParams({ ...context, workoutId });
          }} />}
      </TrainingStack.Screen>
    </TrainingStack.Navigator>
  );
}
