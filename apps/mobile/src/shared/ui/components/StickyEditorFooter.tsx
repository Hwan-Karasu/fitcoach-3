import { useEffect, useState } from "react";
import { Keyboard, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { AppButton } from "./AppButton.tsx";
import { InlineNotice, type NoticeKind } from "./InlineNotice.tsx";
import { fonts } from "../theme/typography.ts";
import { useBottomPanelInFlow } from "./BottomPanel.tsx";

interface StickyEditorFooterProps {
  readonly actionLabel: string;
  readonly actionAccessibilityLabel?: string;
  readonly onAction: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly message?: string | null;
  readonly messageKind?: NoticeKind;
  readonly note?: string;
  readonly onCancel?: () => void;
  /** Второстепенное действие рядом с «Отмена»; тогда главная кнопка — отдельной строкой во всю ширину. */
  readonly secondaryAction?: Readonly<{ label: string; onPress: () => void; busy?: boolean }>;
}

export function StickyEditorFooter({
  actionLabel,
  actionAccessibilityLabel,
  onAction,
  busy = false,
  disabled = false,
  message,
  messageKind = "info",
  note,
  onCancel,
  secondaryAction,
}: Readonly<StickyEditorFooterProps>) {
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const inFlow = useBottomPanelInFlow();
  const { fontScale } = useWindowDimensions();
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  return (
    <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: inFlow || keyboardVisible ? 8 : Math.max(8, insets.bottom) }]}>
      {message ? <InlineNotice kind={messageKind}>{message}</InlineNotice> : null}
      {secondaryAction !== undefined ? fontScale > 1.3 ? <>
        {/* Крупный системный шрифт: прежняя раскладка столбцом, подписи не обрезаются. */}
        <AppButton compact label={actionLabel} accessibilityLabel={actionAccessibilityLabel} onPress={onAction} busy={busy}
          disabled={disabled || secondaryAction.busy === true} />
        <AppButton compact label={secondaryAction.label} variant="secondary" busy={secondaryAction.busy} disabled={busy} onPress={secondaryAction.onPress} />
        {onCancel ? <AppButton compact label="Отмена" variant="secondary" disabled={busy || secondaryAction.busy === true} onPress={onCancel} /> : null}
      </> : (
        // Одна строка плотных кнопок 34 dp (область нажатия 48 dp): «Отмена» и второстепенное — мягкие, главное — заливка справа.
        <View style={styles.compactRow}>
          {onCancel ? <View style={styles.cancel}><AppButton compact size="small" label="Отмена" variant="secondary"
            disabled={busy || secondaryAction.busy === true} onPress={onCancel} /></View> : null}
          <View style={styles.wide}><AppButton compact size="small" label={secondaryAction.label} variant="secondary"
            busy={secondaryAction.busy} disabled={busy} onPress={secondaryAction.onPress} /></View>
          <View style={styles.wide}><AppButton compact size="small" label={actionLabel} accessibilityLabel={actionAccessibilityLabel}
            onPress={onAction} busy={busy} disabled={disabled || secondaryAction.busy === true} /></View>
        </View>
      ) : <View style={{ flexDirection: fontScale > 1.3 ? "column" : "row", gap: 6 }}>
      {onCancel ? <View style={fontScale > 1.3 ? undefined : { flex: 1 }}><AppButton compact label="Отмена" variant="secondary" disabled={busy} onPress={onCancel} /></View> : null}
      <View style={fontScale > 1.3 ? undefined : { flex: 2 }}><AppButton
        compact
        label={actionLabel}
        accessibilityLabel={actionAccessibilityLabel}
        onPress={onAction}
        busy={busy}
        disabled={disabled}
      /></View>
      </View>}
      {note && !keyboardVisible ? <Text style={[styles.note, { color: colors.textMuted }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, gap: 6 },
  compactRow: { flexDirection: "row", gap: 6 },
  cancel: { flex: 1 },
  wide: { flex: 1.3 },
  note: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 14, textAlign: "center" },
});
