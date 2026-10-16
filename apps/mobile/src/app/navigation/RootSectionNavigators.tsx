import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ClientsArchivePreview, ClientsRosterPreview, type ClientArchivePort,
  type ClientListQueryPort, type ClientRepositoryPort,
  type ClientRosterPort } from "../../features/clients/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

type ClientsRoutes = { Roster: undefined };
type ArchiveRoutes = { ArchiveList: undefined };

const ClientsStack = createNativeStackNavigator<ClientsRoutes>();
const ArchiveStack = createNativeStackNavigator<ArchiveRoutes>();

export function ClientsNavigator({ onOpenCreate, onOpenEdit, onOpenClient, repository,
  readModel }: Readonly<{
  onOpenCreate: () => void; onOpenEdit: (clientId: string) => void;
  onOpenClient: (clientId: string) => void;
  repository: ClientRosterPort;
  readModel: ClientListQueryPort;
}>) {
  const { palette } = usePrototypeTheme();
  return (
    <ClientsStack.Navigator screenOptions={{ contentStyle: { backgroundColor: palette.tokens.canvas } }}>
      <ClientsStack.Screen name="Roster" options={{ headerShown: false }}>
        {() => <ClientsRosterPreview onOpenCreate={onOpenCreate}
          onOpenEdit={onOpenEdit} onOpenClient={onOpenClient} repository={repository}
          readModel={readModel} />}
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
