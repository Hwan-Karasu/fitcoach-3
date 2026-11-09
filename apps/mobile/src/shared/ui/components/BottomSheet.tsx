import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

/**
 * Нижний лист (UIX-02/03, UI-OWN-064/066): подложка, ручка, заголовок по центру, содержимое с прокруткой и закреплённый низ
 * (кнопки). Закрывается нажатием вне листа и системной «Назад». Родной `Modal`: не зависит от очереди `@gorhom/bottom-sheet`.
 */
export function BottomSheet({ visible, title, onClose, children, footer }: Readonly<{
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Закреплённый низ листа: кнопки действий. */
  footer?: ReactNode;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable accessible={false} importantForAccessibility="no" style={styles.scrim} onPress={onClose} />
        <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.canvas, paddingBottom: insets.bottom + 12 }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {footer}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "flex-end" },
  scrim: { position: "absolute", top: 0, bottom: 0, left: 0, right: 0, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { maxHeight: "88%", borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 16, paddingTop: 8, gap: 10 },
  handle: { alignSelf: "center", width: 40, height: 4, borderRadius: 2 },
  title: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 22, textAlign: "center" },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: 14, paddingBottom: 4 },
});
