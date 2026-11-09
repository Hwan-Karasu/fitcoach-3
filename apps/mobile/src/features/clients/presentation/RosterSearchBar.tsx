import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Menu, Plus, Search, X } from "lucide-react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow, TOUCH_TARGET } from "../../../shared/ui/theme/style.ts";

/**
 * Нижняя пилюля «Клиентов» (UIX-02, UI-OWN-060): слева кнопка фильтров (три линии, счётчик активных), поле поиска,
 * справа круглая акцентная «+». Лупы в шапке у вкладки нет; текст поиска — общий с шапкой через `useHeaderSearch`.
 */
export function RosterSearchBar({ query, onChangeQuery, filterCount, onOpenFilters, onCreate }: Readonly<{
  query: string;
  onChangeQuery: (value: string) => void;
  /** Число включённых фильтров листа; 0 — без счётчика. */
  filterCount: number;
  onOpenFilters: () => void;
  onCreate: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={[styles.bar, shadow.floating, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={filterCount > 0 ? `Фильтры клиентов, включено: ${filterCount}` : "Фильтры клиентов"}
        onPress={onOpenFilters} style={styles.round}>
        <Menu size={22} color={colors.textPrimary} strokeWidth={2} />
        {filterCount > 0 ? (
          <View style={[styles.badge, { backgroundColor: colors.accentFill }]}>
            <Text style={[styles.badgeText, { color: colors.onAccentFill }]}>{filterCount}</Text>
          </View>
        ) : null}
      </Pressable>
      <View style={[styles.field, { backgroundColor: colors.input }]}>
        <Search size={18} color={colors.textMuted} strokeWidth={2} />
        <TextInput value={query} onChangeText={onChangeQuery} placeholder="Найти клиента" placeholderTextColor={colors.textMuted}
          selectionColor={colors.accentInk} returnKeyType="search" accessibilityLabel="Поиск по клиентам"
          style={[styles.input, { color: colors.textPrimary }]} />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Очистить поиск" hitSlop={14} onPress={() => onChangeQuery("")}>
            <X size={18} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Создать карточку клиента" onPress={onCreate}
        hitSlop={{ top: 2, bottom: 2, left: 1, right: 1 }}
        style={({ pressed }) => [styles.round, styles.plus, { backgroundColor: colors.accentFill, opacity: pressed ? 0.85 : 1 }]}>
        <Plus size={24} color={colors.onAccentFill} strokeWidth={2.2} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { position: "absolute", left: 12, right: 12, bottom: 8, minHeight: 56, borderRadius: 28, borderWidth: 1,
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6 },
  round: { width: TOUCH_TARGET, height: TOUCH_TARGET, borderRadius: TOUCH_TARGET / 2, alignItems: "center", justifyContent: "center" },
  plus: { width: 46, height: 46, borderRadius: 23 },
  field: { flex: 1, minWidth: 0, height: 44, borderRadius: 22, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12 },
  input: { flex: 1, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 0 },
  badge: { position: "absolute", top: 2, right: 0, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14 },
});
