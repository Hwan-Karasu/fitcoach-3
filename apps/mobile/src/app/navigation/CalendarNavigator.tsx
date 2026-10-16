import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CalendarPreview, CalendarSettingsPreview } from "../../features/calendar/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

type CalendarStackRoutes = {
  CalendarHome: undefined;
  CalendarSettings: undefined;
};

const Stack = createNativeStackNavigator<CalendarStackRoutes>();

export function CalendarNavigator() {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="CalendarHome" options={{ headerShown: false }}>
        {({ navigation }) => <CalendarPreview onOpenSettings={() => navigation.navigate("CalendarSettings")} />}
      </Stack.Screen>
      <Stack.Screen name="CalendarSettings" component={CalendarSettingsPreview} options={{ title: "Настройки календаря" }} />
    </Stack.Navigator>
  );
}
