import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, BottomSheet, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";

/**
 * Лист ввода одного значения дня (UIX-05, UI-OWN-069): вес или шаги цифровой клавиатурой. Кнопки «Записать» на экране нет:
 * значение пишется по «Готово» на клавиатуре или по кнопке листа. `onSave` возвращает текст ошибки (лист остаётся открытым,
 * введённое не теряется) или `null` при успехе. Пустое значение для шагов очищает день, для веса — не записывается.
 */
export function ValueSheet({ visible, title, label, unit, initial, keyboardType, placeholder, emptyMessage, onSave, onClose }: Readonly<{
  visible: boolean;
  title: string;
  label: string;
  unit: string;
  initial: string;
  keyboardType: "decimal-pad" | "number-pad";
  placeholder: string;
  /** Пустое значение недопустимо (вес): показывается это сообщение. Не задано — пустое сохраняется (шаги: очистить день). */
  emptyMessage?: string;
  onSave: (text: string) => Promise<string | null>;
  onClose: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Текст сбрасывается только при открытии: пришедшие позже данные дня не затирают ввод.
  useEffect(() => { if (visible) { setText(initial); setError(null); } }, [visible]);
  const submit = async () => {
    if (busy) return;
    if (text.trim() === initial.trim()) { onClose(); return; }
    if (text.trim() === "" && emptyMessage !== undefined) { setError(emptyMessage); return; }
    setBusy(true);
    const message = await onSave(text);
    setBusy(false);
    if (message === null) onClose(); else setError(message);
  };
  return (
    <BottomSheet visible={visible} title={title} onClose={onClose}
      footer={<AppButton label="Сохранить" busy={busy} onPress={() => { void submit(); }} />}>
      <View style={styles.row}>
        <View style={styles.field}>
          <TextField label={label} value={text} autoFocus textAlign="center" keyboardType={keyboardType} placeholder={placeholder} returnKeyType="done"
            error={error ?? undefined} onChangeText={(value) => { setText(value); setError(null); }} onSubmitEditing={() => { void submit(); }} />
        </View>
        <Text style={[styles.unit, { color: colors.textSecondary }]}>{unit}</Text>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  field: { flex: 1 },
  unit: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21, paddingTop: 22 },
});
