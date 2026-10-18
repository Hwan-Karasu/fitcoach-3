import { useState, type Ref } from "react";
import { StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

interface TextFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (value: string) => void;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly keyboardType?: TextInputProps["keyboardType"];
  readonly autoCapitalize?: TextInputProps["autoCapitalize"];
  readonly autoComplete?: TextInputProps["autoComplete"];
  readonly returnKeyType?: TextInputProps["returnKeyType"];
  readonly onSubmitEditing?: TextInputProps["onSubmitEditing"];
  readonly inputRef?: Ref<TextInput>;
  readonly testID?: string;
  /** Подпись только для TalkBack: смысл поля ясен из карточки (например, название тренировки). */
  readonly hideLabel?: boolean;
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  required = false,
  disabled = false,
  disabledReason,
  keyboardType,
  autoCapitalize,
  autoComplete,
  returnKeyType,
  onSubmitEditing,
  inputRef,
  testID,
  hideLabel = false,
}: Readonly<TextFieldProps>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const borderColor = error ? colors.danger : focused ? colors.focusRing : colors.border;
  const helpText = error ?? (disabled ? disabledReason : hint);
  return (
    <View style={styles.field}>
      {hideLabel ? null : <Text style={[styles.label, { color: colors.textPrimary }]}>{label}{required ? " *" : ""}</Text>}
      <TextInput
        ref={inputRef}
        accessibilityLabel={required ? `${label}, обязательное поле` : label}
        accessibilityHint={helpText}
        accessibilityState={{ disabled }}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accentInk}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        editable={!disabled}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        testID={testID}
        style={[styles.input, { backgroundColor: colors.input, borderColor, color: colors.textPrimary, opacity: disabled ? 0.6 : 1 }]}
      />
      {error ? <Text accessibilityLiveRegion="polite" style={[styles.helper, { color: colors.danger }]}>{error}</Text> : null}
      {!error && helpText ? <Text style={[styles.helper, { color: colors.textSecondary }]}>{helpText}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  input: { minHeight: 42, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  helper: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
});
