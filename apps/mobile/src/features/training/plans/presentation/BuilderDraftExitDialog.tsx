import { Modal, Text, View } from "react-native";
import { AppButton, InlineNotice } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";

export function BuilderDraftExitDialog({ visible, busy, error, onSave, onDiscard, onContinue }: Readonly<{
  visible: boolean; busy: boolean; error: string | null; onSave: () => void; onDiscard: () => void; onContinue: () => void;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onContinue(); }}>
    <View style={{ flex: 1, justifyContent: "center", padding: 24, backgroundColor: "rgba(0,0,0,0.4)" }}>
      <View accessibilityViewIsModal style={{ padding: 20, borderRadius: 20, gap: 12, backgroundColor: colors.surface }}>
        <Text style={{ fontSize: 19, color: colors.textPrimary }}>Сохранить работу в конструкторе?</Text>
        <Text style={{ color: colors.textSecondary }}>Черновик можно продолжить позже. Его удаление не затрагивает сохранённую программу.</Text>
        {!!error && <InlineNotice kind="error">{error}</InlineNotice>}
        <AppButton label="Сохранить черновик" busy={busy} onPress={onSave} />
        <AppButton label="Удалить черновик" variant="destructive" disabled={busy} onPress={onDiscard} />
        <AppButton label="Продолжить редактирование" variant="secondary" disabled={busy} onPress={onContinue} />
      </View>
    </View>
  </Modal>;
}
