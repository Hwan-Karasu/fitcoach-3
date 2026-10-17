import { useEffect, useRef, type RefObject } from "react";
import { AccessibilityInfo, Modal, Pressable, ScrollView, StyleSheet, Text, View, findNodeHandle } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { AppButton } from "./AppButton.tsx";
import { fonts } from "../theme/typography.ts";

interface ConfirmDialogProps {
  readonly visible: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly confirmBusy?: boolean;
  readonly tertiaryLabel?: string;
  readonly onTertiary?: () => void;
  readonly returnFocusTo?: RefObject<View | null>;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export function ConfirmDialog({
  visible,
  title,
  description,
  confirmLabel,
  cancelLabel = "Отмена",
  destructive = false,
  confirmBusy = false,
  tertiaryLabel,
  onTertiary,
  returnFocusTo,
  onConfirm,
  onCancel,
}: Readonly<ConfirmDialogProps>) {
  const titleRef = useRef<Text>(null);
  const wasVisible = useRef(false);
  const returnFocus = useRef(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const cancel = () => {
    if (confirmBusy) return;
    returnFocus.current = true;
    onCancel();
  };
  const confirm = () => {
    if (confirmBusy) return;
    returnFocus.current = false;
    onConfirm();
  };

  useEffect(() => {
    if (visible) {
      wasVisible.current = true;
      return;
    }
    if (!wasVisible.current) return;
    wasVisible.current = false;
    const focusTarget = returnFocus.current ? returnFocusTo : undefined;
    returnFocus.current = false;
    if (!focusTarget) return;
    const timer = setTimeout(() => {
      const handle = findNodeHandle(focusTarget.current);
      if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
    }, 250);
    return () => clearTimeout(timer);
  }, [visible, returnFocusTo]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={cancel}
      onShow={() => {
        const handle = findNodeHandle(titleRef.current);
        if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle);
      }}
    >
      <View style={styles.overlay}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={cancel} style={styles.scrim} />
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ScrollView style={styles.copyScroll} contentContainerStyle={styles.copyContent} keyboardShouldPersistTaps="handled">
            <Text ref={titleRef} accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
            <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text>
          </ScrollView>
          <View style={styles.actions}>
            <AppButton label={cancelLabel} variant="secondary" disabled={confirmBusy} disabledReason="Дождитесь завершения операции" onPress={cancel} />
            {tertiaryLabel && onTertiary ? (
              <AppButton label={tertiaryLabel} variant="secondary" disabled={confirmBusy}
                disabledReason="Дождитесь завершения операции" onPress={onTertiary} />
            ) : null}
            <AppButton label={confirmLabel} variant={destructive ? "destructive" : "primary"} busy={confirmBusy} onPress={confirm} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 20 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.48)" },
  card: { maxHeight: "90%", width: "100%", borderWidth: 1, borderRadius: 16, padding: 20, gap: 12 },
  copyScroll: { flexGrow: 0, flexShrink: 1 },
  copyContent: { gap: 12 },
  title: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bold },
  description: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  actions: { gap: 8, marginTop: 8 },
});
