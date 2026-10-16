import { useRef, useState } from "react";
import { Keyboard, StyleSheet, Text, TextInput, View } from "react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { AppIconButton } from "./AppIconButton.tsx";

interface SearchFieldProps {
  readonly query: string;
  readonly onChangeQuery: (value: string) => void;
  readonly accessibilityLabel: string;
  readonly placeholder?: string;
}

export function SearchField({ query, onChangeQuery, accessibilityLabel, placeholder = "Поиск по имени" }: Readonly<SearchFieldProps>) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={styles.row}>
      <TextInput
        ref={inputRef}
        accessibilityLabel={accessibilityLabel}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        selectionColor={colors.accentInk}
        value={query}
        onChangeText={onChangeQuery}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        returnKeyType="search"
        onSubmitEditing={() => Keyboard.dismiss()}
        style={[styles.input, {
          backgroundColor: colors.input,
          borderColor: focused ? colors.focusRing : colors.border,
          color: colors.textPrimary,
        }]}
      />
      <View style={styles.clearSlot}>
        {query ? (
          <AppIconButton
            icon={<Text style={[styles.clearGlyph, { color: colors.textSecondary }]}>×</Text>}
            label={`Очистить: ${accessibilityLabel.toLowerCase()}`}
            onPress={() => { onChangeQuery(""); inputRef.current?.focus(); }}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  clearSlot: { width: 48, minHeight: 48, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 48, borderWidth: 2, borderRadius: 8, paddingHorizontal: 12, fontSize: 14 },
  clearGlyph: { fontSize: 26, lineHeight: 30 },
});
