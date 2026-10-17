import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { CalendarScreen, CalendarSettingsScreen, IntervalEditorScreen,
  type CalendarCreditPort, type CalendarParticipantDirectoryPort,
  type CalendarRepositoryPort, type GuestLinkRequest } from "../../features/calendar/public.ts";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

/** Маршруты вкладки «Календарь»; настройки открываются шестерёнкой в шапке вкладки. */
export type CalendarStackRoutes = {
  CalendarHome: undefined;
  CalendarSettings: undefined;
  CalendarInterval: { localDate: string };
};

const Stack = createNativeStackNavigator<CalendarStackRoutes>();

export function CalendarNavigator({ repository, participants, credit, onCreateClientFromGuest }: Readonly<{
  repository: CalendarRepositoryPort;
  participants: CalendarParticipantDirectoryPort;
  credit: CalendarCreditPort;
  onCreateClientFromGuest: (request: GuestLinkRequest) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Stack.Navigator
      screenOptions={{
        // RootTabs already applies the top safe area; a nested header must not add it again.
        // Android-only and marked unstable in native-stack 7.19; re-check on upgrade (F01).
        unstable_headerInsets: { top: false },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.textPrimary,
        headerTitleStyle: { fontFamily: fonts.bold },
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="CalendarHome" options={{ headerShown: false }}>
        {({ navigation }) => <CalendarScreen repository={repository} participants={participants} credit={credit}
          onCreateClientFromGuest={onCreateClientFromGuest}
          onOpenInterval={(localDate) => navigation.navigate("CalendarInterval", { localDate })} />}
      </Stack.Screen>
      <Stack.Screen name="CalendarSettings" options={{ title: "Настройки календаря" }}>
        {() => <CalendarSettingsScreen repository={repository} />}
      </Stack.Screen>
      <Stack.Screen name="CalendarInterval" options={{ title: "Дежурство или блокировка" }}>
        {({ navigation, route }) => <IntervalEditorScreen repository={repository}
          localDate={route.params.localDate} onClose={() => navigation.goBack()} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
