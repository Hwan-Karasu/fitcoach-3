import { createContext, useContext, type ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { Users } from "lucide-react-native";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

const OpenClients = createContext<(() => void) | null>(null);

export function ClientsListNavigationProvider({ onOpen, children }: Readonly<{ onOpen: () => void; children: ReactNode }>) {
  return <OpenClients.Provider value={onOpen}>{children}</OpenClients.Provider>;
}

export function ClientsListShortcut() {
  const open = useContext(OpenClients);
  const { palette: { tokens: colors } } = usePrototypeTheme();
  return <Pressable accessibilityRole="button" accessibilityLabel="К списку клиентов" onPress={() => open?.()}
    testID="navigation-clients-shortcut"
    style={({ pressed }) => [styles.shortcut, { borderTopColor: colors.divider, backgroundColor: pressed ? colors.accentSoft : "transparent" }]}>
    <Users size={16} color={colors.accentInk} />
    <Text style={[styles.label, { color: colors.accentInk }]}>К списку клиентов</Text>
  </Pressable>;
}

const styles = StyleSheet.create({
  shortcut: { minHeight: 36, borderTopWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
});
