import { useEffect, useRef, useState, type RefObject } from "react";
import { AccessibilityInfo, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle,
  useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Bell, ChevronRight, Palette, SlidersHorizontal, X, type LucideIcon } from "lucide-react-native";
import { AppIconButton, BrandMark } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";

interface SettingsDrawerPreviewProps {
  readonly visible: boolean;
  readonly returnFocusTo: RefObject<View | null>;
  readonly onClose: () => void;
  readonly onOpenSettings: () => void;
  readonly onOpenAppearance: () => void;
  readonly onOpenNotificationSettings: () => void;
  readonly onOpenWorkspaceDev?: () => void;
  readonly onOpenSqliteDev?: () => void;
}

function DrawerLink({ title, detail, icon: Icon, onPress }: Readonly<{ title: string; detail: string; icon: LucideIcon; onPress: () => void }>) {
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
          borderColor: focused ? colors.focusRing : "transparent",
          backgroundColor: focused || pressed ? colors.accentSoft : colors.surface,
        },
      ]}
    >
      <View style={[styles.linkIcon, { backgroundColor: colors.accentSoft }]}><Icon size={21} color={colors.onAccentSoft} strokeWidth={1.8} /></View>
      <View style={styles.linkBody}>
        <Text style={[styles.linkText, { color: colors.textPrimary }]}>{title}</Text>
        <Text style={[styles.linkDetail, { color: colors.textSecondary }]}>{detail}</Text>
      </View>
      <ChevronRight size={17} color={colors.iconSecondary} />
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
}: Readonly<SettingsDrawerPreviewProps>) {
  const titleRef = useRef<Text>(null);
  const pendingRoute = useRef<(() => void) | null>(null);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.9, 360);
  // Окно меню живёт, пока идёт анимация закрытия; выезд справа — со стороны кнопки меню.
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (active) setReduceMotion(enabled); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => { active = false; subscription.remove(); };
  }, []);
  useEffect(() => { if (visible) setMounted(true); }, [visible]);
  useEffect(() => {
    // Native Modal must be shown before starting; otherwise part of the opening is invisible.
    if (!shown) return;
    const animation = Animated.timing(progress, { toValue: visible ? 1 : 0,
      duration: reduceMotion ? 0 : visible ? 320 : 240,
      easing: visible ? Easing.bezier(0.22, 1, 0.36, 1) : Easing.inOut(Easing.cubic), useNativeDriver: true });
    animation.start(({ finished }) => {
      if (!finished || visible) return;
      setMounted(false);
      setShown(false);
      const route = pendingRoute.current;
      pendingRoute.current = null;
      // Defer navigation until the closing frame is committed, avoiding simultaneous screen work.
      requestAnimationFrame(() => {
        if (route) route();
        else {
          const handle = findNodeHandle(returnFocusTo.current);
          if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
        }
      });
    });
    return () => animation.stop();
  }, [progress, visible, shown, reduceMotion, returnFocusTo]);
  const dismiss = () => {
    if (!visible || pendingRoute.current) return;
    onClose();
  };
  const open = (route: () => void) => {
    if (!visible || pendingRoute.current) return;
    pendingRoute.current = route;
    onClose();
  };

  return (
    <Modal
      visible={mounted}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismiss}
      onShow={() => {
        setShown(true);
        const handle = findNodeHandle(titleRef.current);
        if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
      }}
    >
      <View style={styles.modalRoot}>
        <Animated.View style={[styles.scrim, { opacity: progress }]}>
          <Pressable accessible={false} importantForAccessibility="no" onPress={dismiss} style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View pointerEvents={visible ? "auto" : "none"} style={{ width: drawerWidth, transform: [{ translateX: progress.interpolate({
          inputRange: [0, 1], outputRange: [drawerWidth, 0] }) }] }}>
        <SafeAreaView
          accessibilityViewIsModal
          edges={["top", "bottom"]}
          style={[styles.drawer, { backgroundColor: colors.canvas }]}
        >
          <ScrollView contentContainerStyle={styles.drawerContent}>
            <View style={styles.drawerHeader}>
              <View style={[styles.brand, { backgroundColor: colors.accentSoft }]}><BrandMark size={25} color={colors.onAccentSoft} /></View>
              <Text ref={titleRef} accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Дневник атлета</Text>
              <AppIconButton icon={<X size={20} color={colors.iconPrimary} />} label="Закрыть меню" onPress={dismiss} />
            </View>
            <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>Меню</Text>
            <DrawerLink icon={Palette} title="Оформление" detail="Темы и акценты" onPress={() => open(onOpenAppearance)} />
            <DrawerLink icon={SlidersHorizontal} title="Настройки" detail="Параметры приложения" onPress={() => open(onOpenSettings)} />
            <DrawerLink icon={Bell} title="Уведомления" detail="Напоминания и тихие часы" onPress={() => open(onOpenNotificationSettings)} />
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
  drawer: { height: "100%", borderTopLeftRadius: 26, borderBottomLeftRadius: 26, overflow: "hidden" },
  drawerContent: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24 },
  drawerHeader: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 24 },
  brand: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, fontSize: 16, lineHeight: 21, fontFamily: fonts.bold },
  groupLabel: { fontSize: 13, lineHeight: 18, fontFamily: fonts.semibold, marginBottom: 10, paddingLeft: 4 },
  link: { minHeight: 74, borderWidth: 2, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  linkIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  linkBody: { flex: 1, minWidth: 0, gap: 3 },
  linkText: { fontSize: 14, lineHeight: 19, fontFamily: fonts.bold },
  linkDetail: { fontSize: 11, lineHeight: 15, fontFamily: fonts.regular },
});
