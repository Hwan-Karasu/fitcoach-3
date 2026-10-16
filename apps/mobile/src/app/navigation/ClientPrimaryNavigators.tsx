import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ClientHomePreview, type ClientRecord } from "../../features/clients/public.ts";
import { NutritionWorkspacePreview } from "../../features/nutrition/public.ts";
import { TrainingLibraryPreview } from "../../features/training/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

type HomeRoutes = { HomeIndex: undefined };
type NutritionRoutes = { NutritionIndex: undefined };
type TrainingRoutes = { TrainingIndex: undefined };

const HomeStack = createNativeStackNavigator<HomeRoutes>();
const NutritionStack = createNativeStackNavigator<NutritionRoutes>();
const TrainingStack = createNativeStackNavigator<TrainingRoutes>();

export function HomeNavigator({ client, onOpenEdit, onArchive }: Readonly<{
  client: ClientRecord; onOpenEdit: () => void; onArchive: () => Promise<void>;
}>) {
  const { palette } = usePrototypeTheme();
  return (
    <HomeStack.Navigator screenOptions={{ contentStyle: { backgroundColor: palette.tokens.canvas } }}>
      <HomeStack.Screen name="HomeIndex" options={{ headerShown: false }}>
        {() => <ClientHomePreview client={client} onEdit={onOpenEdit} onArchive={onArchive} />}
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
