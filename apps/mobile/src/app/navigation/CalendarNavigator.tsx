import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ScreenHeader } from "../../shared/ui/components/public.ts";
import { CalendarScreen, CalendarSettingsScreen,
  type CalendarCreditPort, type CalendarParticipantDirectoryPort,
  type CalendarRepositoryPort, type GuestLinkRequest } from "../../features/calendar/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

/** Маршруты вкладки «Календарь»; настройки открываются шестерёнкой в шапке вкладки. */
export type CalendarStackRoutes = {
  CalendarHome: undefined;
  CalendarSettings: undefined;
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
        header: ({ navigation, options, back }) => <ScreenHeader insetTop={false} title={options.title}
          onBack={back !== undefined ? () => navigation.goBack() : undefined} />,
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="CalendarHome" options={{ headerShown: false }}>
        {() => <CalendarScreen repository={repository} participants={participants} credit={credit}
          onCreateClientFromGuest={onCreateClientFromGuest} />}
      </Stack.Screen>
      <Stack.Screen name="CalendarSettings" options={{ title: "Настройки календаря" }}>
        {() => <CalendarSettingsScreen repository={repository} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
