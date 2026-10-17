import { useRef, useState, type ReactNode } from "react";
import { Keyboard, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Search, X } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

interface SearchFieldProps {
  readonly query: string;
  readonly onChangeQuery: (value: string) => void;
  readonly accessibilityLabel: string;
  readonly placeholder?: string;
  /** Кнопка справа от поля той же высоты, например фильтры (UI-OWN-008). */
  readonly accessory?: ReactNode;
}

export function SearchField({ query, onChangeQuery, accessibilityLabel, placeholder = "Поиск по имени",
  accessory }: Readonly<SearchFieldProps>) {
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={styles.row}>
      <View style={[styles.field, {
        backgroundColor: colors.input,
        borderColor: focused ? colors.focusRing : colors.border,
        borderWidth: focused ? 2 : 1,
      }]}>
        <Search size={20} color={colors.textMuted} strokeWidth={2} />
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
          style={[styles.input, { color: colors.textPrimary }]}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Очистить: ${accessibilityLabel.toLowerCase()}`}
            hitSlop={8}
            onPress={() => { onChangeQuery(""); inputRef.current?.focus(); }}
            style={styles.clear}
          >
            <X size={18} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
      {accessory}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  field: { flex: 1, minHeight: 48, borderRadius: 10, paddingLeft: 12, paddingRight: 4, flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, minHeight: 44, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  clear: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
});
