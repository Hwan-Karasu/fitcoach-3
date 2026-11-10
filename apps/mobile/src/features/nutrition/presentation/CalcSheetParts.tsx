import { StyleSheet, Text, TextInput, View, Pressable } from "react-native";
import { ChevronRight } from "lucide-react-native";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";

/** Элементы листов «Расчёт» и «Профиль и активность» по макету OnlyFits: сегменты-пилюли, сетка пилюль, поле-пилюля, плитка со стрелкой. */

interface Item<Id extends string> { readonly id: Id; readonly label: string }

/** Сегменты на дорожке `raised` (макет `segm2`): выбранный — акцентная пилюля; высота сегмента 42 (в профиле 38). */
export function PillSegments<Id extends string>({ label, items, value, onChange, disabled = false, height = 42 }: Readonly<{
  label: string; items: readonly Item<Id>[]; value: Id | ""; onChange: (id: Id) => void; disabled?: boolean; height?: number;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={[styles.track, { backgroundColor: colors.surfaceRaised }]}>
      {items.map((item) => {
        const on = item.id === value;
        return (
          <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: on, disabled }} disabled={disabled}
            hitSlop={{ top: Math.max(0, (48 - height) / 2), bottom: Math.max(0, (48 - height) / 2) }} onPress={() => onChange(item.id)}
            style={[styles.segment, { height, backgroundColor: on ? colors.accentFill : "transparent", opacity: disabled ? 0.5 : 1 }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.segmentText, { color: on ? colors.onAccentFill : colors.textSecondary }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Сетка пилюль (макет `opts`): `columns` равных колонок, выбранная — акцентная, остальные — белые с тенью. */
export function OptionGrid<Id extends string>({ label, items, value, onChange, columns, disabled = false }: Readonly<{
  label: string; items: readonly Item<Id>[]; value: Id; onChange: (id: Id) => void; columns: number; disabled?: boolean;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const basis = `${(100 - (columns - 1) * 2) / columns}%` as const;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.grid}>
      {items.map((item) => {
        const on = item.id === value;
        return (
          <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.label} accessibilityState={{ checked: on, disabled }} disabled={disabled}
            hitSlop={{ top: 4, bottom: 4 }} onPress={() => onChange(item.id)}
            style={[styles.option, { width: basis }, on ? { backgroundColor: colors.accentFill } : [shadow.chip, { backgroundColor: colors.surface }], { opacity: disabled ? 0.5 : 1 }]}>
            <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.optionText, { color: on ? colors.onAccentFill : colors.textPrimary }]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Подпись раздела листа: 11, капсом, приглушённая (макет `.sheet .lb`). */
export function SheetLabel({ children }: Readonly<{ children: string }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return <Text accessibilityRole="header" style={[styles.label, { color: colors.textMuted }]}>{children}</Text>;
}

/** Поле профиля (макет `fld2`): белая пилюля 56 с мелкой подписью и значением; весь блок нажимается и ставит фокус в поле. */
export function ProfileField({ label, value, onChangeText, placeholder, disabled = false }: Readonly<{
  label: string; value: string; onChangeText: (text: string) => void; placeholder?: string; disabled?: boolean;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <View style={[styles.field, shadow.chip, { backgroundColor: colors.surface, opacity: disabled ? 0.6 : 1 }]}>
      <Text numberOfLines={2} style={[styles.fieldLabel, { color: colors.textMuted }]}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} editable={!disabled} keyboardType="decimal-pad" placeholder={placeholder}
        placeholderTextColor={colors.textMuted} selectionColor={colors.accentInk} style={[styles.fieldInput, { color: colors.textPrimary }]} />
    </View>
  );
}

/** Плитка-выбор со стрелкой (макет `fld2 row`): подпись и «›», высота 48. */
export function LinkTile({ label, onPress, disabled = false, accessibilityHint }: Readonly<{ label: string; onPress: () => void; disabled?: boolean; accessibilityHint?: string }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={accessibilityHint} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.tile, shadow.chip, { backgroundColor: colors.surface, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
      <Text numberOfLines={1} style={[styles.tileText, { color: colors.textPrimary }]}>{label}</Text>
      <ChevronRight size={18} color={colors.textMuted} />
    </Pressable>
  );
}

/** Мягкая пилюля действия (макет `pillbtn`): высота 44, акцентный текст на `accentSoft`. */
export function SoftPill({ label, onPress, disabled = false }: Readonly<{ label: string; onPress: () => void; disabled?: boolean }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.soft, { backgroundColor: colors.accentSoft, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 }]}>
      <Text style={[styles.softText, { color: colors.accentInk }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: "row", borderRadius: 999, padding: 3 },
  segment: { flex: 1, minWidth: 0, borderRadius: 999, paddingHorizontal: 4, alignItems: "center", justifyContent: "center" },
  segmentText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "space-between" },
  option: { height: 40, borderRadius: 20, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  optionText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  label: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.66, textTransform: "uppercase", marginTop: 4 },
  field: { flex: 1, minWidth: 0, height: 56, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 6, justifyContent: "center" },
  fieldLabel: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 14 },
  fieldInput: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 18, padding: 0, height: 20 },
  tile: { flex: 1, minWidth: 0, height: 48, borderRadius: 20, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  tileText: { flex: 1, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  soft: { height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  softText: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
});
