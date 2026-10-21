import { Pressable, StyleSheet, Text, View } from "react-native";
import { CalendarDays, X } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { pickDate } from "./pickDate.ts";

/** `YYYY-MM-DD` → «ДД.ММ.ГГГГ»; пусто или не дата — пустая строка. */
export function dateLabel(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/u.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : "";
}

/**
 * Поле даты (UI-OWN-023): нажатие открывает системный календарь Android, ручного ввода нет. Значение — локальная дата
 * `YYYY-MM-DD` или пустая строка; крестик сбрасывает необязательную дату.
 */
export function DateField({ label, value, onChange, placeholder = "Выберите дату", hint, error, required = false, disabled = false,
  min, max, startAt, pickerTitle }: Readonly<{
  label: string;
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  min?: string;
  max?: string;
  /** С какой даты открыть календарь, пока значения нет. */
  startAt?: string;
  pickerTitle?: string;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const shown = dateLabel(value);
  const open = () => {
    void pickDate({ value: shown === "" ? startAt ?? max ?? new Date().toISOString().slice(0, 10) : value, min, max, title: pickerTitle ?? label })
      .then((picked) => { if (picked !== null) onChange(picked); });
  };
  const helpText = error ?? hint;
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textPrimary }]}>{label}{required ? " *" : ""}</Text>
      <View style={[styles.box, { backgroundColor: colors.input, borderColor: error ? colors.danger : colors.border, opacity: disabled ? 0.6 : 1 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${shown === "" ? "не выбрана" : shown}. Выбрать дату`}
          accessibilityHint={helpText} disabled={disabled} onPress={open} style={styles.main}>
          <CalendarDays size={18} color={colors.textMuted} />
          <Text style={[styles.value, { color: shown === "" ? colors.textMuted : colors.textPrimary }]}>{shown === "" ? placeholder : shown}</Text>
        </Pressable>
        {shown !== "" && !required ? <Pressable accessibilityRole="button" accessibilityLabel={`${label}: очистить`} disabled={disabled}
          onPress={() => onChange("")} style={styles.clear}>
          <X size={18} color={colors.textMuted} />
        </Pressable> : null}
      </View>
      {error ? <Text accessibilityLiveRegion="polite" style={[styles.helper, { color: colors.danger }]}>{error}</Text> : null}
      {!error && hint ? <Text style={[styles.helper, { color: colors.textSecondary }]}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  box: { flexDirection: "row", alignItems: "center", minHeight: 48, borderWidth: 1, borderRadius: 8 },
  main: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, minHeight: 48, paddingHorizontal: 12 },
  value: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  clear: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  helper: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
