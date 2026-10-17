import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ClientsArchivePreview, ClientsRosterPreview, type ClientArchivePort, type RosterOverviewPort,
  type ClientListQueryPort, type ClientRepositoryPort,
  type ClientRosterPort } from "../../features/clients/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

type ClientsRoutes = { Roster: undefined };
type ArchiveRoutes = { ArchiveList: undefined };

const ClientsStack = createNativeStackNavigator<ClientsRoutes>();
const ArchiveStack = createNativeStackNavigator<ArchiveRoutes>();

export function ClientsNavigator({ onOpenCreate, onOpenClient, repository,
  readModel, overviewSource }: Readonly<{
  onOpenCreate: () => void;
  onOpenClient: (clientId: string) => void;
  repository: ClientRosterPort;
  readModel: ClientListQueryPort;
  overviewSource: RosterOverviewPort;
}>) {
  const { palette } = usePrototypeTheme();
  return (
    <ClientsStack.Navigator screenOptions={{ contentStyle: { backgroundColor: palette.tokens.canvas } }}>
      <ClientsStack.Screen name="Roster" options={{ headerShown: false }}>
        {() => <ClientsRosterPreview onOpenCreate={onOpenCreate}
          onOpenClient={onOpenClient} repository={repository}
          readModel={readModel} overviewSource={overviewSource} />}
      </ClientsStack.Screen>
    </ClientsStack.Navigator>
  );
}

export function ArchiveNavigator({ repository, readModel }: Readonly<{
  repository: ClientRepositoryPort & ClientArchivePort;
  readModel: ClientListQueryPort;
}>) {
  const { palette } = usePrototypeTheme();
  return (
    <ArchiveStack.Navigator screenOptions={{ contentStyle: { backgroundColor: palette.tokens.canvas } }}>
      <ArchiveStack.Screen name="ArchiveList" options={{ headerShown: false }}>
        {() => <ClientsArchivePreview repository={repository} readModel={readModel} />}
      </ArchiveStack.Screen>
    </ArchiveStack.Navigator>
  );
}
