import { useEffect, useRef, useState, type RefObject } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle,
  useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppIconButton } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";

interface SettingsDrawerPreviewProps {
  readonly visible: boolean;
  readonly returnFocusTo: RefObject<View | null>;
  readonly onClose: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenAppearance: () => void;
  readonly onOpenNotificationSettings: () => void;
  readonly onOpenWorkspaceDev: () => void;
  readonly onOpenSqliteDev: () => void;
}

function DrawerLink({ title, onPress }: Readonly<{ title: string; onPress: () => void }>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [
        styles.link,
        {
          borderColor: focused ? colors.focusRing : colors.border,
          backgroundColor: focused || pressed ? colors.surfaceRaised : colors.surface,
        },
      ]}
    >
      <Text style={[styles.linkText, { color: colors.textPrimary }]}>{title}</Text>
      <Text style={[styles.linkArrow, { color: colors.accentInk }]}>›</Text>
    </Pressable>
  );
}

export function SettingsDrawerPreview({
  visible,
  returnFocusTo,
  onClose,
  onOpenSettings,
  onOpenAppearance,
  onOpenNotificationSettings,
  onOpenWorkspaceDev,
  onOpenSqliteDev,
}: Readonly<SettingsDrawerPreviewProps>) {
  const titleRef = useRef<Text>(null);
  const wasVisible = useRef(false);
  const openedRoute = useRef(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.84, 360);
  // Окно меню живёт, пока идёт анимация закрытия; выезд справа — со стороны кнопки меню.
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      return;
    }
    Animated.timing(progress, { toValue: 0, duration: 200, easing: Easing.in(Easing.cubic), useNativeDriver: true })
      .start(({ finished }) => { if (finished) setMounted(false); });
  }, [progress, visible]);
  const dismiss = () => {
    if (openedRoute.current) return;
    openedRoute.current = false;
    onClose();
  };
  const open = (route: () => void) => {
    if (openedRoute.current) return;
    openedRoute.current = true;
    onClose();
    route();
  };

  useEffect(() => {
    if (visible) {
      wasVisible.current = true;
      return;
    }
    if (!wasVisible.current) return;
    wasVisible.current = false;
    if (openedRoute.current) {
      openedRoute.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const handle = findNodeHandle(returnFocusTo.current);
      if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 250);
    return () => clearTimeout(timer);
  }, [visible, returnFocusTo]);

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismiss}
      onShow={() => {
        const handle = findNodeHandle(titleRef.current);
        if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
      }}
    >
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.scrim, { opacity: progress }]}>
          <Pressable accessible={false} importantForAccessibility="no" onPress={dismiss} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={{ width: drawerWidth, transform: [{ translateX: progress.interpolate({
          inputRange: [0, 1], outputRange: [drawerWidth, 0] }) }] }}>
        <SafeAreaView
          accessibilityViewIsModal
          edges={["top", "bottom"]}
          style={[styles.drawer, { backgroundColor: colors.surface }]}
        >
          <ScrollView contentContainerStyle={styles.drawerContent}>
            <View style={styles.drawerHeader}>
              <Text ref={titleRef} accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Меню</Text>
              <AppIconButton icon={<Text style={[styles.closeGlyph, { color: colors.accentInk }]}>×</Text>} label="Закрыть меню" onPress={dismiss} />
            </View>
            <Text style={[styles.groupLabel, { color: colors.textMuted }]}>ИНТЕРФЕЙС</Text>
            <DrawerLink title="Оформление" onPress={() => open(onOpenAppearance)} />
            <Text style={[styles.groupLabel, { color: colors.textMuted }]}>СИСТЕМА</Text>
            <DrawerLink title="Настройки" onPress={() => open(onOpenSettings)} />
            <DrawerLink title="Настройки уведомлений" onPress={() => open(onOpenNotificationSettings)} />
            <Text style={[styles.groupLabel, { color: colors.textMuted }]}>ДЕМОНСТРАЦИЯ</Text>
            <DrawerLink title="Карточка клиента · демо" onPress={() => open(onOpenWorkspaceDev)} />
            <DrawerLink title="SQLite · диагностика" onPress={() => open(onOpenSqliteDev)} />
            <Text style={[styles.footnote, { color: colors.textMuted }]}>Аккаунты и облачная синхронизация не входят в offline V1.</Text>
          </ScrollView>
        </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, flexDirection: "row", justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.48)" },
  drawer: { height: "100%" },
  drawerContent: { paddingHorizontal: 16, paddingTop: 24, paddingBottom: 32 },
  drawerHeader: { minHeight: 48, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  title: { fontSize: 22, lineHeight: 28, fontFamily: fonts.bold, flexShrink: 1 },
  closeGlyph: { fontFamily: fonts.regular, fontSize: 26, lineHeight: 30 },
  groupLabel: { fontSize: 11, lineHeight: 16, fontFamily: fonts.bold, letterSpacing: 0.8, marginTop: 18, marginBottom: 6 },
  link: { minHeight: 56, borderBottomWidth: 2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  linkText: { flex: 1, flexShrink: 1, fontSize: 16, lineHeight: 22, fontFamily: fonts.bold },
  linkArrow: { minWidth: 20, fontFamily: fonts.regular, fontSize: 26, lineHeight: 30, textAlign: "right" },
  footnote: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 24 },
});
