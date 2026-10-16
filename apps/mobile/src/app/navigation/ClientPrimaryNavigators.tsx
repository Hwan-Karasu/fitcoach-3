import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { AccountingRepositoryPort } from "../../features/accounting/public.ts";
import { ClientHomePreview, type ClientRecord } from "../../features/clients/public.ts";
import { localDateOf, parseValueX10, type MeasurementRepositoryPort } from "../../features/measurements/public.ts";
import { useClientHomeSummary } from "../../read-models/useClientHomeSummary.ts";
import { NutritionWorkspacePreview } from "../../features/nutrition/public.ts";
import { TrainingLibraryPreview } from "../../features/training/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

type HomeRoutes = { HomeIndex: undefined };
type NutritionRoutes = { NutritionIndex: undefined };
type TrainingRoutes = { TrainingIndex: undefined };

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

export function TrainingNavigator() {
  const { palette } = usePrototypeTheme();
  return (
    <TrainingStack.Navigator screenOptions={{ contentStyle: { backgroundColor: palette.tokens.canvas } }}>
      <TrainingStack.Screen name="TrainingIndex" component={TrainingLibraryPreview} options={{ headerShown: false }} />
    </TrainingStack.Navigator>
  );
}
