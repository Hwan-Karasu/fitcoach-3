import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { AppointmentEditorScreen, CalendarScreen, CalendarSettingsPreview, IntervalEditorScreen,
  type CalendarCreditPort, type CalendarParticipantDirectoryPort,
  type CalendarRepositoryPort, type GuestLinkRequest } from "../../features/calendar/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

type CalendarStackRoutes = {
  CalendarHome: undefined;
  CalendarSettings: undefined;
  CalendarAppointment: { appointmentId?: string; localDate: string; startMinute?: number };
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
        headerTitleStyle: { fontWeight: "700" },
        contentStyle: { backgroundColor: colors.canvas },
      }}
    >
      <Stack.Screen name="CalendarHome" options={{ headerShown: false }}>
        {({ navigation }) => <CalendarScreen repository={repository} participants={participants}
          onOpenSettings={() => navigation.navigate("CalendarSettings")}
          onOpenAppointment={(params) => navigation.navigate("CalendarAppointment", params)}
          onOpenInterval={(localDate) => navigation.navigate("CalendarInterval", { localDate })} />}
      </Stack.Screen>
      <Stack.Screen name="CalendarSettings" options={{ title: "Настройки календаря" }}>
        {() => <CalendarSettingsPreview repository={repository} />}
      </Stack.Screen>
      <Stack.Screen name="CalendarAppointment"
        options={({ route }) => ({ title: route.params.appointmentId ? "Запись" : "Новая запись" })}>
        {({ navigation, route }) => <AppointmentEditorScreen repository={repository}
          participants={participants} credit={credit} appointmentId={route.params.appointmentId}
          localDate={route.params.localDate} startMinute={route.params.startMinute}
          onClose={() => navigation.goBack()} onCreateClientFromGuest={onCreateClientFromGuest} />}
      </Stack.Screen>
      <Stack.Screen name="CalendarInterval" options={{ title: "Дежурство или блокировка" }}>
        {({ navigation, route }) => <IntervalEditorScreen repository={repository}
          localDate={route.params.localDate} onClose={() => navigation.goBack()} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
