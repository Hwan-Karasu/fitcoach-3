import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Menu, Plus, Search, X } from "lucide-react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow, TOUCH_TARGET } from "../../../shared/ui/theme/style.ts";

/**
 * Нижняя пилюля «Клиентов» и «Архива» (UIX-02/03, UI-OWN-060/066): слева кнопка из трёх линий (фильтры у клиентов, сортировка у архива;
 * счётчик активных), поле поиска, справа круглая акцентная «+» (только у клиентов: `onCreate`). Лупы в шапке нет;
 * текст поиска общий с шапкой вкладки через `useHeaderSearch`.
 */
export function RosterSearchBar({ query, onChangeQuery, placeholder, searchLabel, menuLabel, menuCount = 0, onOpenMenu, onCreate }: Readonly<{
  query: string;
  onChangeQuery: (value: string) => void;
  placeholder: string;
  searchLabel: string;
  /** Подпись кнопки слева для TalkBack: «Фильтры клиентов», «Сортировка архива». */
  menuLabel: string;
  /** Число включённых фильтров; 0 — без счётчика. */
  menuCount?: number;
  onOpenMenu: () => void;
  /** Нет — без «+» (архив). */
  onCreate?: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <View style={[styles.bar, shadow.floating, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={menuCount > 0 ? `${menuLabel}, включено: ${menuCount}` : menuLabel}
        onPress={onOpenMenu} style={styles.round}>
        <Menu size={22} color={colors.textPrimary} strokeWidth={2} />
        {menuCount > 0 ? (
          <View style={[styles.badge, { backgroundColor: colors.accentFill }]}>
            <Text style={[styles.badgeText, { color: colors.onAccentFill }]}>{menuCount}</Text>
          </View>
        ) : null}
      </Pressable>
      <View style={[styles.field, { backgroundColor: colors.input }]}>
        <Search size={18} color={colors.textMuted} strokeWidth={2} />
        <TextInput value={query} onChangeText={onChangeQuery} placeholder={placeholder} placeholderTextColor={colors.textMuted}
          selectionColor={colors.accentInk} returnKeyType="search" accessibilityLabel={searchLabel}
          style={[styles.input, { color: colors.textPrimary }]} />
        {query ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Очистить поиск" hitSlop={14} onPress={() => onChangeQuery("")}>
            <X size={18} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>
      {onCreate === undefined ? null : (
        <Pressable accessibilityRole="button" accessibilityLabel="Создать карточку клиента" onPress={onCreate}
          hitSlop={{ top: 2, bottom: 2, left: 1, right: 1 }}
          style={({ pressed }) => [styles.round, styles.plus, { backgroundColor: colors.accentFill, opacity: pressed ? 0.85 : 1 }]}>
          <Plus size={24} color={colors.onAccentFill} strokeWidth={2.2} />
        </Pressable>
      )}
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
