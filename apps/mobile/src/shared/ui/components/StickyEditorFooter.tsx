import { useEffect, useState } from "react";
import { Keyboard, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { AppButton } from "./AppButton.tsx";
import { InlineNotice, type NoticeKind } from "./InlineNotice.tsx";
import { fonts } from "../theme/typography.ts";

interface StickyEditorFooterProps {
  readonly actionLabel: string;
  readonly actionAccessibilityLabel?: string;
  readonly onAction: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly message?: string | null;
  readonly messageKind?: NoticeKind;
  readonly note?: string;
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
}: Readonly<StickyEditorFooterProps>) {
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const insets = useSafeAreaInsets();
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hidden = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { shown.remove(); hidden.remove(); };
  }, []);
  return (
    <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: keyboardVisible ? 8 : Math.max(8, insets.bottom) }]}>
      {message ? <InlineNotice kind={messageKind}>{message}</InlineNotice> : null}
      <AppButton
        label={actionLabel}
        accessibilityLabel={actionAccessibilityLabel}
        onPress={onAction}
        busy={busy}
        disabled={disabled}
      />
      {note && !keyboardVisible ? <Text style={[styles.note, { color: colors.textMuted }]}>{note}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: { borderTopWidth: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 8 },
  note: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15, textAlign: "center" },
});
