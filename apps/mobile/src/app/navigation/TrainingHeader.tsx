import { useCallback } from "react";
import { BackHandler, StyleSheet, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Users } from "lucide-react-native";
import { AppIconButton } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

/** Единственный владелец шапки тренировочного стека. Android Back и стрелка вызывают один маршрут. */
export function TrainingHeader({ title, clientName, onBack, onClients }: Readonly<{
  title: string; clientName: string; onBack: () => void; onClients: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  useFocusEffect(useCallback(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => { onBack(); return true; });
    return () => listener.remove();
  }, [onBack]));
  return <View style={{ backgroundColor: colors.canvas, paddingTop: insets.top }}>
    <View style={styles.bar}>
      <AppIconButton label="Назад" icon={<ArrowLeft size={21} color={colors.textPrimary} />} onPress={onBack} />
      <View style={styles.text}>
        <Text numberOfLines={1} accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        <Text numberOfLines={1} style={[styles.client, { color: colors.textSecondary }]}>{clientName}</Text>
      </View>
      <AppIconButton label="К списку клиентов" icon={<Users size={20} color={colors.textPrimary} />} onPress={onClients} />
    </View>
  </View>;
}
const styles = StyleSheet.create({
  bar: { minHeight: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 4, gap: 2 },
  text: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  client: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
});
