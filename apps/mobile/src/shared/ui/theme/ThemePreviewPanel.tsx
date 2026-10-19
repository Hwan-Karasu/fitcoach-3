import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, StatusTag, TextField } from "../components/public.ts";
import { usePrototypeTheme } from "./PrototypeThemeProvider.tsx";
import { fonts } from "./typography.ts";

export function ThemePreviewPanel() {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [sampleText, setSampleText] = useState("");
  const [actionShown, setActionShown] = useState(false);
  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.kicker, { color: colors.textMuted }]}>ПРЕДПРОСМОТР КОМПОНЕНТОВ</Text>
      <Text style={[styles.title, { color: colors.textPrimary }]}>{palette.themeName}</Text>
      <Text style={[styles.description, { color: colors.textSecondary }]}>
        Тестовый ввод остаётся на месте при смене темы и акцента. Данные клиентов здесь не используются.
      </Text>
      <TextField
        label="Тестовое поле"
        placeholder="Например, 82,5"
        hint="Только локальный пример; не вводите личные данные"
        value={sampleText}
        onChangeText={setSampleText}
        testID="theme-preview-input"
      />
      <AppButton label="Проверить действие" onPress={() => setActionShown(true)} testID="theme-preview-action" />
      {actionShown ? <InlineNotice kind="info">Это демонстрация кнопки. Ничего не сохранено.</InlineNotice> : null}
      <View style={styles.statusRow}>
        <StatusTag kind="success" label="Успех · пример" />
        <StatusTag kind="warning" label="Внимание · пример" />
        <StatusTag kind="error" label="Ошибка · пример" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  kicker: { fontSize: 11, lineHeight: 14, fontFamily: fonts.bold, letterSpacing: 0.8 },
  title: { fontSize: 16, lineHeight: 22, fontFamily: fonts.bold },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
