import { useEffect, useState } from "react";
import { Keyboard, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { AppButton } from "./AppButton.tsx";
import { InlineNotice, type NoticeKind } from "./InlineNotice.tsx";
import { fonts } from "../theme/typography.ts";
import { useEditorDockLayout } from "./BottomDockLayout.tsx";

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
  const onLayout = useEditorDockLayout();
  const { fontScale } = useWindowDimensions();
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  return (
    <View onLayout={onLayout} style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: keyboardVisible ? 8 : Math.max(8, insets.bottom) }]}>
      {message ? <InlineNotice kind={messageKind}>{message}</InlineNotice> : null}
      {secondaryAction !== undefined ? <>
        <AppButton label={actionLabel} accessibilityLabel={actionAccessibilityLabel} onPress={onAction} busy={busy}
          disabled={disabled || secondaryAction.busy === true} />
        <View style={{ flexDirection: fontScale > 1.3 ? "column" : "row", gap: 8 }}>
          <View style={fontScale > 1.3 ? undefined : { flex: 1 }}><AppButton label={secondaryAction.label} variant="secondary"
            busy={secondaryAction.busy} disabled={busy} onPress={secondaryAction.onPress} /></View>
          {onCancel ? <View style={fontScale > 1.3 ? undefined : { flex: 1 }}><AppButton label="Отмена" variant="secondary"
            disabled={busy || secondaryAction.busy === true} onPress={onCancel} /></View> : null}
        </View>
      </> : <View style={{ flexDirection: fontScale > 1.3 ? "column" : "row", gap: 8 }}>
      {onCancel ? <View style={fontScale > 1.3 ? undefined : { flex: 1 }}><AppButton label="Отмена" variant="secondary" disabled={busy} onPress={onCancel} /></View> : null}
      <View style={fontScale > 1.3 ? undefined : { flex: 2 }}><AppButton
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
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 },
  note: { fontFamily: fonts.regular, fontSize: 10, lineHeight: 14, textAlign: "center" },
});
