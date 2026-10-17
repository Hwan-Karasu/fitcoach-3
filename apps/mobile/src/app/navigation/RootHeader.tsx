import { useEffect, useRef, type RefObject } from "react";
import { Animated, Image, StyleSheet, View } from "react-native";
import { Bell, Menu } from "lucide-react-native";
import { AppIconButton } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { appBrandName } from "./routeCatalog.ts";
import logoMark from "../../../assets/brand/logo-mark.png";

/**
 * Одна строка шапки корневой вкладки (UI-OWN-001/016): вверху — логотип и название приложения,
 * при прокрутке — название раздела; справа колокольчик и меню.
 */
export function RootHeader({
  title,
  collapsed,
  onOpenNotifications,
  onOpenMenu,
  menuButtonRef,
}: Readonly<{ title: string; collapsed: boolean; onOpenNotifications: () => void; onOpenMenu: () => void;
  menuButtonRef: RefObject<View | null> }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const progress = useRef(new Animated.Value(collapsed ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: collapsed ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [collapsed, progress]);
  const brandStyle = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }],
  };
  const titleStyle = {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  };
  return (
    <View style={[styles.header, { backgroundColor: colors.canvas, borderBottomColor: collapsed ? colors.border : "transparent" }]}>
      <View accessible accessibilityRole="header" accessibilityLabel={`${appBrandName}, ${title}`} style={styles.titleSlot}>
        <Animated.View style={[styles.layer, brandStyle]}>
          <Image source={logoMark} style={styles.logo} accessibilityIgnoresInvertColors />
          <Animated.Text numberOfLines={1} style={[styles.brand, { color: colors.textPrimary }]}>{appBrandName}</Animated.Text>
        </Animated.View>
        <Animated.View style={[styles.layer, titleStyle]}>
          <Animated.Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{title}</Animated.Text>
        </Animated.View>
      </View>
      <AppIconButton
        label="Открыть центр уведомлений"
        icon={<Bell size={22} color={colors.textPrimary} strokeWidth={1.8} />}
        onPress={onOpenNotifications}
        testID="open-notifications"
      />
      <AppIconButton
        label="Открыть главное меню"
        buttonRef={menuButtonRef}
        icon={<Menu size={22} color={colors.textPrimary} strokeWidth={1.8} />}
        onPress={onOpenMenu}
        testID="open-menu"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 56, paddingLeft: 16, paddingRight: 4, flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  titleSlot: { flex: 1, height: 56 },
  layer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 10 },
  logo: { width: 32, height: 32 },
  brand: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  title: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
});
