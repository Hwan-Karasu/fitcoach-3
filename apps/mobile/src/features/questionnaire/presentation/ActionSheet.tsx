import type { ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";

export interface SheetAction {
  readonly key: string;
  readonly label: string;
  /** Пояснение под пунктом, например почему пункт недоступен. */
  readonly detail?: string;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

/** Нижнее меню «⋮»: заголовок и список действий; выбор закрывает меню. */
export function ActionSheet({ visible, title, actions, onClose, children }: Readonly<{
  visible: boolean;
  title: string;
  actions: readonly SheetAction[];
  onClose: () => void;
  /** Дополнительное содержимое под заголовком (например поле ввода). */
  children?: ReactNode;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть меню" style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: 8 + insets.bottom, backgroundColor: colors.canvas, borderColor: colors.border }]}>
        <Text accessibilityRole="header" numberOfLines={2} style={[styles.title, { color: colors.textSecondary }]}>{title}</Text>
        {children}
        <ScrollView>
          {actions.map((action) => (
            <Pressable key={action.key} accessibilityRole="button" accessibilityLabel={action.label}
              accessibilityState={{ disabled: action.disabled === true }} disabled={action.disabled}
              onPress={() => { onClose(); action.onPress(); }}
              style={({ pressed }) => [styles.item, { backgroundColor: pressed ? colors.surfaceRaised : "transparent",
                opacity: action.disabled === true ? 0.45 : 1 }]}>
              <Text style={[styles.label, { color: action.danger === true ? colors.danger : colors.textPrimary }]}>{action.label}</Text>
              {action.detail !== undefined ? (
                <Text style={[styles.detail, { color: colors.textMuted }]}>{action.detail}</Text>
              ) : null}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "80%", borderTopLeftRadius: 16,
    borderTopRightRadius: 16, borderWidth: 1, paddingTop: 12 },
  title: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, paddingHorizontal: 20, paddingBottom: 6 },
  item: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 12, justifyContent: "center" },
  label: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 2 },
});
