import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "../../shared/ui/components/public.ts";
import { CommonActions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";
import { ClientHomePreview, type ClientRecord } from "../../features/clients/public.ts";
import { type MeasurementRepositoryPort } from "../../features/measurements/public.ts";
import { useClientHomeSummary } from "../../read-models/useClientHomeSummary.ts";
import { AddFoodScreen, type CalcClientBody, type CatalogFilter, type SaveCalcProfile, FoodEditorScreen, NutritionHomeScreen, RecipeEditorScreen, type FoodCatalogPort, type MealSlot, type NutritionCalcPort, type NutritionDiaryPort, type NutritionTargetsPort,
  type RecipeCatalogPort } from "../../features/nutrition/public.ts";
import { ArchivedProgramsPanel, ParticipantSwitcher, participantTarget, ProgramMatrixScreen, PeriodizedBuilderScreen, ProgramLibraryScreen, ProgramModeChooserScreen, programLibraryTabTitles, ProgramScreen, SimpleProgramBuilderScreen,
  WeekEditorScreen, SimpleWorkoutEditorScreen, TemplateLibraryScreen, TemplateEditorScreen, type PickedExercise, type WeekCopyPort, type WeekSwapPort, type MesocycleSavePort, type SimplePlanSavePort, type WeekEditSavePort, type MesocycleDeletePort, type ProgramDeletePort, type PlanOnlyDeletePort,
  type ExerciseLookupPort, type ProgramKind, type TrainingParticipantCandidate,
  type TrainingPlansRepositoryPort, ProgramWeeksPanel, WorkoutScreen, type ActiveWorkoutsPort, type RestTimersPort, type TrainingExecutionPort,
  type WorkoutSlot } from "../../features/training/public.ts";
import { CustomExerciseEditorScreen, ExerciseLibraryScreen, type ExerciseCatalogPort } from "../../features/exercises/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { ClientHeader } from "./ClientHeader.tsx";

type HomeRoutes = { HomeIndex: undefined };
type NutritionRoutes = {
  NutritionIndex: { section: "calc"; requestKey: number } | undefined;
  NutritionAdd: { localDate: string; slot: MealSlot; filter?: CatalogFilter };
  NutritionFood: { name?: string; foodId?: string; detailsRequest?: number };
  NutritionRecipe: { recipeId?: string } | undefined;
};
const nutritionTitles: Readonly<Record<keyof NutritionRoutes, string>> = { NutritionIndex: "Питание", NutritionAdd: "Добавить еду", NutritionFood: "Продукт", NutritionRecipe: "Рецепт" };
type TrainingRoutes = {
  TrainingIndex: undefined;
  TrainingChooser: undefined;
  TrainingTemplates: undefined;
  TrainingMatrix: { programId: string };
  TrainingTemplateEdit: { templateId: string; picked?: PickedExercise };
  /** Конструктор Расширенной: создание; с `programId` — «+ Мезоцикл», с `mesocycleId` — правка (UI-OWN-041). */
  TrainingCreate: { kind: ProgramKind; picked?: PickedExercise; programId?: string; mesocycleId?: string; weekIndex?: number };
  TrainingProgram: { programId: string; weekIndex?: number; mesocycleId?: string };
  TrainingBuilder: { programId?: string; picked?: PickedExercise } | undefined;
  TrainingWeek: { programId: string; mesocycleId: string; weekIndex: number; picked?: PickedExercise };
  TrainingSimpleWorkout: { programId: string; weekIndex: number; workoutId: string; picked?: PickedExercise };
  /** Каталог для выбора упражнения; результат возвращается на экран `returnTo` с теми же параметрами. */
  TrainingPickExercise: { workoutId: string; replace?: string; returnTo: PickReturn };
  /** `selected` — уже отмеченные в каталоге упражнения: созданное встаёт после них (UI-OWN-029). */
  TrainingCreateExercise: { initialName: string; pick: TrainingRoutes["TrainingPickExercise"]; selected?: readonly string[] };
  /** `closeOnBack` — тренировка открыта из истории упражнения или статистики: «←» закрывает клиента и возвращает туда, откуда пришли. */
  TrainingWorkout: { programId: string; weekIndex: number; workoutId: string; mesocycleId?: string; picked?: PickedExercise; closeOnBack?: boolean };
};

type PickReturn =
  | Readonly<{ name: "TrainingBuilder"; params: { programId?: string } }>
  | Readonly<{ name: "TrainingWeek"; params: { programId: string; mesocycleId: string; weekIndex: number } }>
  | Readonly<{ name: "TrainingSimpleWorkout"; params: { programId: string; weekIndex: number; workoutId: string } }>
  | Readonly<{ name: "TrainingTemplateEdit"; params: { templateId: string } }>
  | Readonly<{ name: "TrainingCreate"; params: { kind: ProgramKind; programId?: string; mesocycleId?: string; weekIndex?: number } }>
  | Readonly<{ name: "TrainingWorkout"; params: { programId: string; weekIndex: number; workoutId: string; mesocycleId?: string } }>;

const trainingTitles: Readonly<Record<keyof TrainingRoutes, string>> = {
  TrainingIndex: "Программы", TrainingChooser: "Создать программу", TrainingCreate: "Расширенная программа",
  TrainingProgram: "Программа", TrainingBuilder: "Простой конструктор",
  TrainingWeek: "Редактирование недели", TrainingPickExercise: "Выбор упражнения", TrainingWorkout: "Дневник тренировки",
  TrainingCreateExercise: "Своё упражнение",
  TrainingSimpleWorkout: "План тренировки",
  TrainingTemplates: "Шаблоны",
  TrainingMatrix: "Матрица недель",
  TrainingTemplateEdit: "Шаблон",
};

const HomeStack = createNativeStackNavigator<HomeRoutes>();
const NutritionStack = createNativeStackNavigator<NutritionRoutes>();
const TrainingStack = createNativeStackNavigator<TrainingRoutes>();

type HomeProps = Readonly<{
  client: ClientRecord; accounting: AccountingRepositoryPort; measurements: MeasurementRepositoryPort;
  onOpenAccounting: () => void;
  nutritionSlot?: ReactNode;
  onArchive: () => Promise<void>;
}>;

/** Home composes owners' read projections; the weight entry goes to the Measurements owner. */
function HomeIndexRoute({ client, accounting, measurements, onOpenAccounting, nutritionSlot,
  onArchive }: HomeProps) {
  const summary = useClientHomeSummary(client.id, accounting, measurements);
  return <ClientHomePreview client={client} summary={summary} onOpenAccounting={onOpenAccounting}
    nutritionSlot={nutritionSlot} onArchive={onArchive} />;
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

/** «Питание» клиента: дневник, добавление еды из своего каталога, создание продукта. Шапку клиента рисует стек (как у «Тренировок»). */
/**
 * Маршрут «Добавить еду»: пока в выборе есть позиции, выход (кнопка «назад», жест, системная кнопка) спрашивает «Отменить выбор?» (NUT-FS-26).
 * После успешной записи выбор пуст — выход свободный.
 */
function NutritionAddRoute({ navigation, children, recipe = false, food = false }: Readonly<{ navigation: { addListener: (event: "beforeRemove", listener: (event: { preventDefault: () => void; data: { action: never } }) => void) => () => void;
  dispatch: (action: never) => void }; recipe?: boolean; food?: boolean; children: (onDirtyChange: (dirty: boolean) => void) => ReactNode }>) {
  const dirty = useRef(false);
  const [pending, setPending] = useState<never | null>(null);
  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (!dirty.current) return;
    event.preventDefault();
    setPending(event.data.action);
  }), [navigation]);
  return (
    <>
      {children((value) => { dirty.current = value; })}
      <ConfirmDialog visible={pending !== null} destructive title={food ? "Отменить изменения продукта?" : recipe ? "Отменить изменения рецепта?" : "Отменить выбор?"} confirmLabel={recipe || food ? "Отменить изменения" : "Отменить выбор"} cancelLabel="Продолжить"
        description={recipe || food ? "Изменения ещё не сохранены и будут потеряны." : "Выбранные позиции не записаны в дневник и будут потеряны."} onCancel={() => setPending(null)}
        onConfirm={() => { const action = pending; setPending(null); dirty.current = false; if (action !== null) navigation.dispatch(action); }} />
    </>
  );
}

export function NutritionNavigator({ clientId, clientName, clientEmoji, body, onSaveProfile, onOpenJournal, foods, recipes, diary, targets, calc, measurements, onExitClient, onOpenClients }: Readonly<{
  clientId: string; clientName: string; clientEmoji: string | null; body: CalcClientBody; onSaveProfile: SaveCalcProfile;
  foods: FoodCatalogPort; recipes: RecipeCatalogPort; diary: NutritionDiaryPort; targets: NutritionTargetsPort; calc: NutritionCalcPort; measurements: MeasurementRepositoryPort; onOpenJournal: () => void;
  onExitClient: () => void; onOpenClients: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  return (
    <NutritionStack.Navigator screenOptions={({ navigation, route }) => ({
      contentStyle: { backgroundColor: palette.tokens.canvas },
      header: () => <ClientHeader subtitle={nutritionTitles[route.name]} client={{ displayName: clientName, emoji: clientEmoji }}
        onClients={onOpenClients} onBack={() => { if (route.name === "NutritionIndex") onExitClient(); else navigation.goBack(); }}
        trailingAction={route.name === "NutritionFood" && route.params?.foodId !== undefined
          ? { label: "Изменить название, бренд и штрихкод", onPress: () => navigation.setParams({ detailsRequest: (route.params.detailsRequest ?? 0) + 1 }) } : undefined} />,
    })}>
      <NutritionStack.Screen name="NutritionIndex">
        {({ navigation, route }) => <NutritionHomeScreen requestedSection={route.params?.section} sectionRequestKey={route.params?.requestKey} clientId={clientId} onOpenJournal={onOpenJournal} body={body} onSaveProfile={onSaveProfile} diary={diary} targets={targets} calc={calc} measurements={measurements}
          onAdd={(localDate, slot, filter) => navigation.navigate("NutritionAdd", { localDate, slot, filter })}
          onEditSource={(source) => source.kind === "FOOD" ? navigation.navigate("NutritionFood", { foodId: source.id }) : navigation.navigate("NutritionRecipe", { recipeId: source.id })} />}
      </NutritionStack.Screen>
      <NutritionStack.Screen name="NutritionAdd" options={{ headerShown: false }}>
        {({ navigation, route }) => <NutritionAddRoute navigation={navigation}>
          {(onDirtyChange) => <AddFoodScreen key={`${clientId}:${route.params.localDate}:${route.params.slot}`} clientId={clientId} localDate={route.params.localDate} slot={route.params.slot} initialFilter={route.params.filter}
            foods={foods} recipes={recipes} diary={diary} onCreateFood={(name) => navigation.navigate("NutritionFood", { name })} onDirtyChange={onDirtyChange} onAdded={() => navigation.goBack()} onBack={() => navigation.goBack()}
            onCreateRecipe={() => navigation.navigate("NutritionRecipe")} onEditFood={(foodId) => navigation.navigate("NutritionFood", { foodId })} onEditRecipe={(recipeId) => navigation.navigate("NutritionRecipe", { recipeId })} />}
        </NutritionAddRoute>}
      </NutritionStack.Screen>
      <NutritionStack.Screen name="NutritionFood">
        {({ navigation, route }) => <NutritionAddRoute navigation={navigation} food>{(onDirtyChange) =>
          <FoodEditorScreen key={route.params.foodId ?? "new"} foods={foods} foodId={route.params.foodId} initialName={route.params.name} detailsRequest={route.params.detailsRequest} onDirtyChange={onDirtyChange} onSaved={() => navigation.goBack()} />
        }</NutritionAddRoute>}
      </NutritionStack.Screen>
      <NutritionStack.Screen name="NutritionRecipe">
        {({ navigation, route }) => <NutritionAddRoute navigation={navigation} recipe>{(onDirtyChange) =>
          <RecipeEditorScreen recipeId={route.params?.recipeId} foods={foods} recipes={recipes} onDirtyChange={onDirtyChange} onSaved={() => navigation.goBack()} />
        }</NutritionAddRoute>}
      </NutritionStack.Screen>
    </NutritionStack.Navigator>
  );
}

/**
 * §48.4 вкладка «Тренировки»: список программ → (выбор конструктора → создание) → программа.
 * Стек не сбрасывается при смене вкладок; после создания в стеке «список → программа».
 * Шапка — общая строка карточки клиента (UI-OWN-001), назад — системной кнопкой.
 */
export function TrainingNavigator({ clientId, clientName, clientEmoji, onOpenExercise, repository, execution, restTimers, activeWorkouts, onOpenWorkout, onOpenClientPrograms,
  listCandidates, exercises, exerciseLookup, weekCopy, weekSwap, mesocycleSave, planDelete, onExitClient, onOpenClients }: Readonly<{
  clientId: string;
  clientName: string;
  clientEmoji: string | null;
  repository: TrainingPlansRepositoryPort;
  execution: TrainingExecutionPort;
  restTimers: RestTimersPort;
  activeWorkouts: ActiveWorkoutsPort;
  onOpenWorkout: (slot: WorkoutSlot) => void;
  /** «Назад» с программы участника группы (не клиента карточки) — список программ этого участника. */
  onOpenClientPrograms: (clientId: string) => void;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>;
  exercises: ExerciseCatalogPort;
  exerciseLookup: ExerciseLookupPort;
  weekCopy: WeekCopyPort;
  weekSwap: WeekSwapPort;
  mesocycleSave: MesocycleSavePort & SimplePlanSavePort & WeekEditSavePort;
  planDelete: MesocycleDeletePort & ProgramDeletePort & PlanOnlyDeletePort;
  onExitClient: () => void;
  onOpenClients: () => void;
  /** Карточка упражнения из дневника (корневой стек). */
  onOpenExercise?: (exerciseId: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  // UI-OWN-043: участник группы, чьи данные открыты (как в 2.0); `null` — клиент карточки. Экраны стека получают его.
  const [participant, setParticipant] = useState<string | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    let active = true;
    listCandidates().then((rows) => { if (active) setNames(new Map(rows.map((row) => [row.id, row.displayName]))); }).catch(() => undefined);
    return () => { active = false; };
  }, [listCandidates]);
  const viewer = participant ?? clientId;
  const viewerName = participant === null ? clientName : names.get(participant) ?? "Клиент";
  // `prepare` только вычисляет переход; участник и параметры маршрута меняются в одном такте — иначе экран на миг
  // получает программу нового участника с прежним клиентом (ошибка «Не удалось выбрать мезоцикл»).
  const switchTo = async (next: string, prepare: () => Promise<() => void>) => {
    if (switching) return;
    setSwitching(true);
    try { const apply = await prepare(); setParticipant(next === clientId ? null : next); apply(); } catch { /* Прежний участник остаётся. */ }
    finally { setSwitching(false); }
  };
  // Простая программа создаётся сразу в конструкторе; расширенная — пока через название и участников.
  const createRoute = (kind: ProgramKind) => kind === "SIMPLE" ? { name: "TrainingBuilder" as const, params: {} }
    : { name: "TrainingCreate" as const, params: { kind } };
  return (
    <TrainingStack.Navigator initialRouteName="TrainingIndex" screenOptions={({ navigation, route }) => ({
      contentStyle: { backgroundColor: palette.tokens.canvas },
      // Подзаголовок — заголовок экрана; экран может его сменить (вкладка «Шаблоны» программы).
      header: ({ options }) => <ClientHeader subtitle={options.title ?? trainingTitles[route.name]} client={{ displayName: viewerName, emoji: participant === null ? clientEmoji : null }}
        onClients={onOpenClients} onBack={() => {
          if (route.name === "TrainingWorkout") {
            const params = route.params as TrainingRoutes["TrainingWorkout"];
            // Без экрана программы в стеке «назад» создавал бы его заново и грузил весь план («Открываем мезоциклы…»).
            if (params.closeOnBack === true) { onExitClient(); return; }
            navigation.popTo("TrainingProgram", { programId: params.programId, weekIndex: params.weekIndex, mesocycleId: params.mesocycleId });
          } else if (route.name === "TrainingProgram") {
            // Решение владельца: «назад» ведёт к программам того участника, чьи данные открыты.
            if (participant !== null) onOpenClientPrograms(participant); else navigation.popTo("TrainingIndex");
          }
          else if (route.name === "TrainingIndex") onExitClient();
          else navigation.goBack();
        }} />,
    })}>
      <TrainingStack.Screen name="TrainingIndex" listeners={{ focus: () => setParticipant(null) }}>
        {({ navigation }) => <ProgramLibraryScreen clientId={clientId} repository={repository}
          onChoose={(kind) => { const route = createRoute(kind); navigation.navigate(route.name, route.params as never); }}
          onCreate={() => navigation.navigate("TrainingChooser")}
          onOpenTemplates={() => navigation.navigate("TrainingTemplates")}
          onTabChange={(tab) => navigation.setOptions({ title: programLibraryTabTitles[tab] })}
          renderTemplates={() => <TemplateLibraryScreen clientId={viewer} repository={repository} listCandidates={listCandidates}
            onEdit={(templateId) => navigation.navigate("TrainingTemplateEdit", { templateId })}
            onCreated={(programId) => navigation.navigate("TrainingProgram", { programId })} />}
          renderArchive={() => <ArchivedProgramsPanel clientId={clientId} repository={repository} planDelete={planDelete} />}
          onOpenProgram={(programId) => navigation.navigate("TrainingProgram", { programId })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingTemplateEdit">
        {({ navigation, route }) => <TemplateEditorScreen templateId={route.params.templateId} repository={repository}
          exercises={exerciseLookup} picked={route.params.picked ?? null}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId,
            ...(replace === undefined ? {} : { replace }),
            returnTo: { name: "TrainingTemplateEdit", params: { templateId: route.params.templateId } } })}
          onSaved={() => navigation.goBack()} onCancel={() => navigation.goBack()} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingMatrix">
        {/* UI-OWN-045: матрица — таблица с правкой на месте, без перехода в дневник по нажатию. */}
        {({ route }) => <ProgramMatrixScreen clientId={viewer} programId={route.params.programId} plans={repository}
          execution={execution} exercises={exerciseLookup} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingTemplates">
        {({ navigation }) => <TemplateLibraryScreen clientId={viewer} repository={repository} listCandidates={listCandidates}
          onEdit={(templateId) => navigation.navigate("TrainingTemplateEdit", { templateId })}
          onCreated={(programId) => navigation.reset({ index: 1,
            routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId } }] })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingChooser">
        {({ navigation }) => <ProgramModeChooserScreen onChoose={(kind) => { const route = createRoute(kind); navigation.navigate(route.name, route.params as never); }}
          onOpenTemplates={() => navigation.navigate("TrainingTemplates")} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingCreate" options={({ route }) => ({ title: route.params.mesocycleId !== undefined ? "Изменение мезоцикла"
        : route.params.programId !== undefined ? "Новый мезоцикл" : trainingTitles.TrainingCreate })}>
        {/* Расширенная — конструктор 2.0 (UI-OWN-038): программа, участники и первый мезоцикл одной записью. */}
        {({ navigation, route }) => <PeriodizedBuilderScreen clientId={viewer} repository={repository} exercises={exerciseLookup}
          programId={route.params.programId} mesocycleId={route.params.mesocycleId} initialWeek={route.params.weekIndex}
          mesocycleSave={mesocycleSave}
          onSaved={(mesocycleId) => navigation.popTo("TrainingProgram", { programId: route.params.programId!, mesocycleId })}
          listCandidates={listCandidates} picked={route.params.picked ?? null} onCancel={() => navigation.goBack()}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId,
            ...(replace === undefined ? {} : { replace }), returnTo: { name: "TrainingCreate", params: { kind: route.params.kind,
              ...(route.params.programId === undefined ? {} : { programId: route.params.programId }),
              ...(route.params.mesocycleId === undefined ? {} : { mesocycleId: route.params.mesocycleId }) } } })}
          renderTemplates={() => <TemplateLibraryScreen clientId={viewer} repository={repository} listCandidates={listCandidates}
            onEdit={(templateId) => navigation.navigate("TrainingTemplateEdit", { templateId })}
            onCreated={(createdId) => navigation.reset({ index: 1,
              routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId: createdId } }] })} />}
          onCreated={(programId) => navigation.reset({ index: 1,
            routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId } }] })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingProgram">
        {({ navigation, route }) => <ProgramScreen clientId={viewer} programId={route.params.programId}
          requestedWeek={route.params.weekIndex} requestedMesocycle={route.params.mesocycleId}
          repository={repository} listCandidates={listCandidates} exercises={exerciseLookup} weekCopy={weekCopy} weekSwap={weekSwap} planDelete={planDelete}
          onOpenMatrix={() => navigation.navigate("TrainingMatrix", { programId: route.params.programId })}
          onTabChange={(tab) => navigation.setOptions({ title: tab === "templates" ? "Шаблоны" : trainingTitles.TrainingProgram })}
          renderParticipants={(current, shown) => <ParticipantSwitcher clientId={shown?.clientId ?? viewer} activeClientId={viewer}
            anchorClientId={clientId} programId={shown?.programId ?? route.params.programId} mesocycleId={current().mesocycleId}
            repository={repository} names={names} busy={switching} onSelect={(next) => { void switchTo(next.clientId, async () => {
              const target = await participantTarget(repository, { clientId: viewer, programId: route.params.programId }, next, current());
              if (target === null) throw new Error("TARGET_NOT_FOUND");
              return () => navigation.setParams({ programId: target.programId, weekIndex: target.weekIndex,
                ...(target.mesocycleId === null ? {} : { mesocycleId: target.mesocycleId }) });
            }); }} />}
          renderTemplates={() => <TemplateLibraryScreen clientId={viewer} repository={repository} listCandidates={listCandidates}
            onEdit={(templateId) => navigation.navigate("TrainingTemplateEdit", { templateId })}
            onCreated={(createdId) => navigation.reset({ index: 1,
              routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId: createdId } }] })} />}
          onOpenProgram={(createdId) => navigation.reset({ index: 1,
            routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId: createdId } }] })}
          renderWeeks={(view) => <ProgramWeeksPanel key={view.key} clientId={viewer} programId={route.params.programId} weeks={view.weeks}
            renderWeekActions={view.weekActions} execution={execution} selectedWeek={view.selectedWeek} onSelectWeek={view.onSelectWeek}
            header={view.header} afterCard={view.afterCard} onLoaded={view.onLoaded}
            onOpenWorkout={(weekIndex, workoutId) => navigation.navigate("TrainingWorkout", { programId: route.params.programId, weekIndex, workoutId,
              ...(view.mesocycleId === undefined ? {} : { mesocycleId: view.mesocycleId }) })} />}
          onEditStructure={() => navigation.navigate("TrainingBuilder", { programId: route.params.programId })}
          onAddMesocycle={() => navigation.navigate("TrainingCreate", { kind: "PERIODIZED", programId: route.params.programId })}
          onEditWeek={(mesocycleId, weekIndex) => navigation.navigate("TrainingCreate", { kind: "PERIODIZED", programId: route.params.programId,
            mesocycleId, weekIndex })}
          onArchived={() => navigation.popTo("TrainingIndex")} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingBuilder">
        {({ navigation, route }) => <SimpleProgramBuilderScreen clientId={viewer} programId={route.params?.programId ?? null}
          onCancel={() => navigation.goBack()}
          repository={repository} simplePlanSave={mesocycleSave} exercises={exerciseLookup} picked={route.params?.picked ?? null}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId,
            ...(replace === undefined ? {} : { replace }),
            returnTo: { name: "TrainingBuilder", params: { ...(route.params?.programId === undefined ? {} : { programId: route.params.programId }) } } })}
          onSaved={(programId) => navigation.reset({ index: 1,
            routes: [{ name: "TrainingIndex" }, { name: "TrainingProgram", params: { programId } }] })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingPickExercise">
        {({ navigation, route }) => <ExerciseLibraryScreen repository={exercises} picking
          multiPick={route.params.replace === undefined}
          onCreate={(initialName, selected) => navigation.navigate("TrainingCreateExercise", { initialName, pick: route.params, selected })}
          onPick={(exerciseIds) => {
            const picked: PickedExercise = { token: `${Date.now()}`, workoutId: route.params.workoutId, exerciseIds,
              ...(route.params.replace === undefined ? {} : { replace: route.params.replace }) };
            const back = route.params.returnTo;
            if (back.name === "TrainingBuilder") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingWeek") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingWorkout") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingCreate") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
          }} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingCreateExercise">
        {({ navigation, route }) => <CustomExerciseEditorScreen repository={exercises} initialName={route.params.initialName}
          onCancel={() => navigation.goBack()} onSaved={(exerciseId) => {
            const source = route.params.pick;
            const picked: PickedExercise = { token: `${Date.now()}`, workoutId: source.workoutId,
              exerciseIds: [...(route.params.selected ?? []), exerciseId],
              ...(source.replace === undefined ? {} : { replace: source.replace }) };
            const back = source.returnTo;
            if (back.name === "TrainingBuilder") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingWeek") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingWorkout") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else if (back.name === "TrainingCreate") navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
            else navigation.popTo(back.name, { ...back.params, picked }, { merge: true });
          }} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingWeek">
        {({ navigation, route }) => <WeekEditorScreen clientId={viewer} programId={route.params.programId}
          onCancel={() => navigation.goBack()}
          mesocycleId={route.params.mesocycleId} weekIndex={route.params.weekIndex}
          repository={repository} weekEdit={mesocycleSave} exercises={exerciseLookup} listCandidates={listCandidates} picked={route.params.picked ?? null}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId,
            ...(replace === undefined ? {} : { replace }),
            returnTo: { name: "TrainingWeek", params: { programId: route.params.programId, mesocycleId: route.params.mesocycleId,
              weekIndex: route.params.weekIndex } } })}
          onSaved={() => navigation.goBack()} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingSimpleWorkout">
        {({ navigation, route }) => <SimpleWorkoutEditorScreen clientId={viewer} clientName={clientName}
          programId={route.params.programId} weekIndex={route.params.weekIndex} workoutId={route.params.workoutId}
          repository={repository} exercises={exerciseLookup} picked={route.params.picked ?? null}
          onCancel={() => navigation.goBack()} onSaved={() => navigation.goBack()}
          onPickExercise={(workoutId, replace) => navigation.navigate("TrainingPickExercise", { workoutId,
            ...(replace === undefined ? {} : { replace }), returnTo: { name: "TrainingSimpleWorkout",
              params: { programId: route.params.programId, weekIndex: route.params.weekIndex, workoutId: route.params.workoutId } } })} />}
      </TrainingStack.Screen>
      <TrainingStack.Screen name="TrainingWorkout">
        {({ route, navigation }) => <WorkoutScreen slot={{ clientId: viewer, programId: route.params.programId, weekIndex: route.params.weekIndex,
          plannedWorkoutId: route.params.workoutId }} clientName={viewerName}
          renderParticipants={(finishInput) => <ParticipantSwitcher clientId={viewer} anchorClientId={clientId} programId={route.params.programId}
            workoutId={route.params.workoutId}
            repository={repository} names={names} busy={switching} onSelect={(next) => { void switchTo(next.clientId, async () => {
              if (!await finishInput()) throw new Error("INPUT_NOT_SAVED");
              const target = await participantTarget(repository, { clientId: viewer, programId: route.params.programId }, next,
                { mesocycleId: route.params.mesocycleId ?? null, weekIndex: route.params.weekIndex, workoutId: route.params.workoutId });
              if (target === null) throw new Error("TARGET_NOT_FOUND");
              // Копия участника может лежать в его собственной программе (UI-OWN-044).
              const context = { programId: target.programId, weekIndex: target.weekIndex,
                ...(target.mesocycleId === null ? {} : { mesocycleId: target.mesocycleId }) };
              // Экран программы под дневником тоже переходит к этому участнику (как маршруты 2.0).
              const workoutId = target.workoutId;
              return () => {
                const program = navigation.getState().routes.findLast((item: { name: string }) => item.name === "TrainingProgram");
                if (program !== undefined) navigation.dispatch({ ...CommonActions.setParams(context), source: program.key });
                if (workoutId === null) navigation.popTo("TrainingProgram", context);
                else navigation.setParams({ ...context, workoutId });
              };
            }); }} />} plans={repository} execution={execution}
          restTimers={restTimers} activeWorkouts={activeWorkouts} onOpenWorkout={onOpenWorkout} exercises={exerciseLookup}
          picked={route.params.picked ?? null} onOpenExercise={onOpenExercise}
          onOpenMatrix={() => navigation.navigate("TrainingMatrix", { programId: route.params.programId })}
          onPickExercises={(replace) => navigation.navigate("TrainingPickExercise", { workoutId: route.params.workoutId,
            ...(replace === undefined ? {} : { replace }),
            returnTo: { name: "TrainingWorkout", params: { programId: route.params.programId, weekIndex: route.params.weekIndex,
              workoutId: route.params.workoutId, ...(route.params.mesocycleId === undefined ? {} : { mesocycleId: route.params.mesocycleId }) } } })}
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
