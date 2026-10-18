import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";
import { ClientHomePreview, type ClientRecord } from "../../features/clients/public.ts";
import { localDateOf, parseValueX10, type MeasurementRepositoryPort } from "../../features/measurements/public.ts";
import { useClientHomeSummary } from "../../read-models/useClientHomeSummary.ts";
import { NutritionWorkspacePreview } from "../../features/nutrition/public.ts";
import { CreateProgramScreen, ProgramLibraryScreen, ProgramModeChooserScreen, ProgramScreen, SimpleProgramBuilderScreen,
  type ExerciseLookupPort, type ProgramKind, type TrainingParticipantCandidate,
  type TrainingPlansRepositoryPort, ProgramWeeksPanel, WorkoutScreen, type ActiveWorkoutsPort, type RestTimersPort, type TrainingExecutionPort,
  type WorkoutSlot } from "../../features/training/public.ts";
import { ExerciseLibraryScreen, type ExerciseCatalogPort } from "../../features/exercises/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

type HomeRoutes = { HomeIndex: undefined };
type NutritionRoutes = { NutritionIndex: undefined };
type TrainingRoutes = {
  TrainingIndex: undefined;
  TrainingChooser: undefined;
  TrainingCreate: { kind: ProgramKind };
  TrainingProgram: { programId: string };
  TrainingBuilder: { programId?: string; picked?: { token: string; workoutId: string; exerciseId: string; replace?: string } } | undefined;
  TrainingPickExercise: { workoutId: string; programId?: string; replace?: string };
  TrainingWorkout: { programId: string; weekIndex: number; workoutId: string };
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
  listCandidates, exercises, exerciseLookup }: Readonly<{
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
}>) {
  const { palette } = usePrototypeTheme();
  // Простая программа создаётся сразу в конструкторе; расширенная — пока через название и участников.
  const createRoute = (kind: ProgramKind) => kind === "SIMPLE" ? { name: "TrainingBuilder" as const, params: {} }
    : { name: "TrainingCreate" as const, params: { kind } };
  return (
    <TrainingStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.tokens.canvas } }}>
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
          listCandidates={listCandidates}
          onCreated={(programId) => navigation.reset({ index: 1,
            routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId } }] })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingProgram">
        {({ navigation, route }) => <ProgramScreen clientId={clientId} programId={route.params.programId}
          repository={repository} listCandidates={listCandidates} exercises={exerciseLookup}
          renderWeeks={(plan) => <ProgramWeeksPanel clientId={clientId} programId={route.params.programId} weeks={plan.weeks}
            workouts={plan.workouts} execution={execution}
            onOpenWorkout={(weekIndex, workoutId) => navigation.navigate("TrainingWorkout", { programId: route.params.programId, weekIndex, workoutId })} />}
          onEditStructure={() => navigation.navigate("TrainingBuilder", { programId: route.params.programId })}
          onArchived={() => navigation.popTo("TrainingIndex")} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingBuilder">
        {({ navigation, route }) => <SimpleProgramBuilderScreen clientId={clientId} programId={route.params?.programId ?? null}
          repository={repository} exercises={exerciseLookup} picked={route.params?.picked ?? null}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId, programId: route.params?.programId,
            ...(replace === undefined ? {} : { replace }) })}
          onSaved={(programId) => navigation.reset({ index: 1,
            routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId } }] })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingPickExercise">
        {({ navigation, route }) => <ExerciseLibraryScreen repository={exercises} picking
          onCreate={() => undefined}
          onOpen={(exerciseId) => navigation.popTo("TrainingBuilder", { programId: route.params.programId,
            picked: { token: `${Date.now()}`, workoutId: route.params.workoutId, exerciseId,
              ...(route.params.replace === undefined ? {} : { replace: route.params.replace }) } }, { merge: true })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingWorkout">
        {({ route }) => <WorkoutScreen slot={{ clientId, programId: route.params.programId, weekIndex: route.params.weekIndex,
          plannedWorkoutId: route.params.workoutId }} clientName={clientName} plans={repository} execution={execution}
          restTimers={restTimers} activeWorkouts={activeWorkouts} onOpenWorkout={onOpenWorkout} exercises={exerciseLookup} />}
      </TrainingStack.Screen>
    </TrainingStack.Navigator>
  );
}
