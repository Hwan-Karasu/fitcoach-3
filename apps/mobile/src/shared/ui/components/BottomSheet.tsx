import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { scrim } from "../theme/style.ts";
import { sheetSettle } from "./bottomSheetRules.ts";

/**
 * Нижний лист (UIX-02/03, UI-OWN-064/066): подложка, ручка, заголовок по центру, содержимое с прокруткой и закреплённый низ
 * (кнопки). Закрывается нажатием вне листа, системной «Назад» и **жестом вниз за ручку или заголовок**: лист идёт за пальцем,
 * после отпускания закрывается (далеко или быстро) либо возвращается пружиной (`sheetSettle`). Родной `Modal`: не зависит от
 * очереди `@gorhom/bottom-sheet`; жесты внутри `Modal` на Android требуют своего `GestureHandlerRootView`.
 */
export function BottomSheet({ visible, title, onClose, children, footer, fill = false }: Readonly<{
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Закреплённый низ листа: кнопки действий. */
  footer?: ReactNode;
  /** Лист высотой 92 % без собственной прокрутки: внутри лежит экран со своей прокруткой (например, расчёт калорий). */
  fill?: boolean;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const insets = useSafeAreaInsets();
  const shift = useSharedValue(0);
  const height = useSharedValue(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const close = useCallback(() => closeRef.current(), []);
  // Лист открывается на месте, даже если прошлый раз его закрыли жестом (сдвиг остался равным высоте).
  useEffect(() => { if (visible) shift.value = 0; }, [visible, shift]);
  const pan = useMemo(() => Gesture.Pan().activeOffsetY([-10, 10]).failOffsetX([-24, 24])
    .onUpdate((event) => {
      "worklet";
      shift.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      "worklet";
      if (sheetSettle(event.translationY, event.velocityY, height.value) === "close") {
        shift.value = withTiming(height.value, { duration: 160 }, (finished) => { if (finished) scheduleOnRN(close); });
      } else shift.value = withSpring(0, { damping: 24, stiffness: 340 });
    }), [shift, height, close]);
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: shift.value }] }));
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <GestureHandlerRootView style={styles.root}>
        <KeyboardAvoidingView behavior="height" style={styles.overlay}>
          <Pressable accessible={false} importantForAccessibility="no" style={styles.scrim} onPress={onClose} />
          <Animated.View accessibilityViewIsModal onLayout={(event) => { height.value = event.nativeEvent.layout.height; }}
            style={[styles.sheet, fill ? styles.sheetFill : null, { backgroundColor: colors.canvas, paddingBottom: insets.bottom + 12 }, moved]}>
            <GestureDetector gesture={pan}>
              <View collapsable={false} style={styles.grab}>
                <View style={[styles.handle, { backgroundColor: colors.border }]} />
                <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
              </View>
            </GestureDetector>
            {fill ? <View style={styles.fill}>{children}</View>
              : <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>}
            {footer}
          </Animated.View>
        </KeyboardAvoidingView>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  overlay: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: scrim },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  sheetFill: { height: "92%", maxHeight: "92%" },
  fill: { flex: 1, marginHorizontal: -16 },
  grab: { gap: 10, paddingBottom: 2 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, textAlign: "center" },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: 14, paddingBottom: 4 },
});
