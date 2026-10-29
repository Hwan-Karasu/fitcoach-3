import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ProgramTemplate } from "../domain/TemplateModel.ts";

const TITLE_MAX = 80;

/**
 * Компактный диалог «Сохранить как шаблон» (PROG-MENU-1): название подставлено и правится, сохранение создаёт независимый шаблон —
 * программа и её результаты не меняются. Вид шаблона задаёт операция: из меню программы — шаблон программы, из карточки цикла — шаблон
 * цикла; сам диалог вид не выбирает.
 */
export function SaveTemplateDialog({ visible, kind, initialTitle, save, onClose, onSaved }: Readonly<{
  visible: boolean;
  kind: "program" | "mesocycle";
  initialTitle: string;
  save: (title: string) => Promise<ProgramTemplate>;
  onClose: () => void;
  onSaved: (template: ProgramTemplate) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [title, setTitle] = useState(initialTitle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (visible) { setTitle(initialTitle.slice(0, TITLE_MAX)); setError(null); } }, [visible, initialTitle]);
  const close = () => { if (!busy) onClose(); };
  const submit = () => {
    setBusy(true); setError(null);
    save(title.trim()).then(onSaved, (cause: unknown) => setError(cause instanceof Error && cause.message === "DRAFT_INVALID"
      ? kind === "program" ? "Введите название (до 80 символов); в программе должен быть план." : "Введите название (до 80 символов)."
      : "Не удалось сохранить шаблон. Программа не изменена.")).finally(() => setBusy(false));
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.overlay}>
        <Pressable accessible={false} importantForAccessibility="no" onPress={close} style={styles.scrim} />
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
            {kind === "program" ? "Сохранить как шаблон" : "Цикл в шаблон"}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>
            {kind === "program"
              ? "Шаблон программы со всеми циклами, неделями и упражнениями этого клиента. Результаты и история в шаблон не входят; программа не изменится."
              : "Шаблон цикла: план этого клиента без результатов. Его можно добавить в любую расширенную программу."}
          </Text>
          <TextField label="Название шаблона" required value={title} disabled={busy} hint={`До ${TITLE_MAX} символов.`}
            onChangeText={setTitle} />
          {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
          <View style={styles.row}>
            <View style={styles.grow}><AppButton variant="secondary" label="Отмена" disabled={busy} onPress={close} /></View>
            <View style={styles.grow}><AppButton label="Сохранить" busy={busy}
              disabled={title.trim().length === 0 || title.trim().length > TITLE_MAX} onPress={submit} /></View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 20 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.48)" },
  card: { width: "100%", borderWidth: 1, borderRadius: 16, padding: 20, gap: 12 },
  title: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: 10 },
  grow: { flex: 1 },
});
