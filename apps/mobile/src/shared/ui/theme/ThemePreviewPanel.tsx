import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, SelectionChip, SectionTabs, StatusTag, TextField } from "../components/public.ts";
import { usePrototypeTheme } from "./PrototypeThemeProvider.tsx";
import { fonts } from "./typography.ts";

export function ThemePreviewPanel() {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [sampleText, setSampleText] = useState("");
  const [actionShown, setActionShown] = useState(false);
  const [tab, setTab] = useState("clients");
  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Компоненты</Text>
      <TextField
        label="Тестовое поле"
        placeholder="Например, 82,5"
        hideLabel
        compact
        value={sampleText}
        onChangeText={setSampleText}
        testID="theme-preview-input"
      />
      <View style={styles.row}>
        <View style={styles.cell}><AppButton label={actionShown ? "Готово" : "Кнопка"} size="small" onPress={() => setActionShown((value) => !value)} testID="theme-preview-action" /></View>
        <View style={styles.cell}><AppButton label="Мягкая" size="small" variant="secondary" onPress={() => setActionShown((value) => !value)} /></View>
        <View style={styles.cell}><AppButton label="Недоступна" size="small" disabled onPress={() => undefined} disabledReason="Пример недоступной кнопки" /></View>
      </View>
      <View style={styles.row}>
        <SelectionChip group="Пример" label="Выбрано" compact fill selected onPress={() => undefined} />
        <SelectionChip group="Пример" label="Обычная" compact fill selected={false} onPress={() => undefined} />
      </View>
      <SectionTabs fill tabs={[{ id: "clients", label: "Клиенты" }, { id: "calendar", label: "Календарь" }, { id: "training", label: "Тренировки" }]} selectedId={tab} onSelect={setTab} />
      <View style={styles.statusRow}>
        <StatusTag fill kind="success" label="Успех" />
        <StatusTag fill kind="warning" label="Внимание" />
        <StatusTag fill kind="error" label="Ошибка" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 12, padding: 10, gap: 8 },
  title: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  row: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  cell: { flex: 1, minWidth: 0 },
  statusRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
});
