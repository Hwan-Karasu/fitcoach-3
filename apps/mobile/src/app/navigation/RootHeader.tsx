import type { RefObject } from "react";
import { StyleSheet, View } from "react-native";
import { AppIconButton } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

function BellIcon({ color }: Readonly<{ color: string }>) {
  return (
    <View style={styles.bellIcon}>
      <View style={[styles.bellHandle, { borderColor: color }]} />
      <View style={[styles.bellDome, { borderColor: color }]} />
      <View style={[styles.bellRim, { backgroundColor: color }]} />
      <View style={[styles.bellClapper, { backgroundColor: color }]} />
    </View>
  );
}

function MenuIcon({ color }: Readonly<{ color: string }>) {
  return (
    <View style={styles.menuIcon}>
      <View style={[styles.menuLine, { backgroundColor: color }]} />
      <View style={[styles.menuLine, { backgroundColor: color }]} />
      <View style={[styles.menuLine, { backgroundColor: color }]} />
    </View>
  );
}

export function RootHeader({
  onOpenNotifications,
  onOpenMenu,
  menuButtonRef,
}: Readonly<{ onOpenNotifications: () => void; onOpenMenu: () => void; menuButtonRef: RefObject<View | null> }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={[styles.header, { backgroundColor: colors.surface, borderBottomColor: colors.border }]}>
      <View style={styles.spacer} />
      <AppIconButton
        label="Открыть центр уведомлений"
        icon={<BellIcon color={colors.accentInk} />}
        onPress={onOpenNotifications}
        testID="open-notifications"
      />
      <AppIconButton
        label="Открыть главное меню"
        buttonRef={menuButtonRef}
        icon={<MenuIcon color={colors.accentInk} />}
        onPress={onOpenMenu}
        testID="open-menu"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 48, borderBottomWidth: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center" },
  spacer: { flex: 1 },
  bellIcon: { width: 24, height: 28 },
  bellHandle: { position: "absolute", left: 9, top: 0, width: 6, height: 6, borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  bellDome: { position: "absolute", left: 3, top: 5, width: 18, height: 17, borderWidth: 2, borderBottomWidth: 0, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  bellRim: { position: "absolute", left: 1, top: 21, width: 22, height: 2, borderRadius: 1 },
  bellClapper: { position: "absolute", left: 9, top: 24, width: 6, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3 },
  menuIcon: { width: 20, height: 18, justifyContent: "space-between" },
  menuLine: { width: 20, height: 2, borderRadius: 1 },
});
