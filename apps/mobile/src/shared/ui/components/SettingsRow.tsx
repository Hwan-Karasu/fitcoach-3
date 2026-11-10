import type { ComponentType, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, type LucideProps } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { shadow } from "../theme/style.ts";

/**
 * Пункт списка настроек (макет OnlyFits): иконка в круге, название и подпись, справа стрелка; у последнего в группе разделителя нет.
 * Без `onPress` строка только показывает значение — без стрелки и нажатия.
 */
export function SettingsRow({ icon: Icon, title, caption, captionMuted = false, last = false, disabled = false, onPress }: Readonly<{
  icon: ComponentType<LucideProps>; title: string; caption: ReactNode; captionMuted?: boolean; last?: boolean; disabled?: boolean; onPress?: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const body = (
    <>
      <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}><Icon size={20} color={colors.accentInk} /></View>
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
        {typeof caption === "string" ? <Text style={[styles.caption, { color: captionMuted ? colors.textMuted : colors.textSecondary }]}>{caption}</Text> : caption}
      </View>
      {onPress === undefined ? null : <ChevronRight size={20} color={colors.textMuted} style={styles.chevron} />}
    </>
  );
  const frame = { borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.border };
  if (onPress === undefined) {
    return <View accessible accessibilityLabel={typeof caption === "string" ? `${title}. ${caption}` : title} style={[styles.row, frame]}>{body}</View>;
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={typeof caption === "string" ? caption : undefined} accessibilityState={{ disabled }}
      disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.row, frame, { backgroundColor: pressed ? colors.surfaceRaised : "transparent", opacity: disabled ? 0.5 : 1 }]}>
      {body}
    </Pressable>
  );
}

/** Круглый блок для строк `SettingsRow`. */
export function SettingsGroup({ children }: Readonly<{ children: ReactNode }>) {
  const colors = usePrototypeTheme().palette.tokens;
  return <View style={[styles.group, shadow.card, { backgroundColor: colors.surface }]}>{children}</View>;
}

const styles = StyleSheet.create({
  group: { borderRadius: 26, overflow: "hidden" },
  row: { minHeight: 68, paddingVertical: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 14 },
  icon: { width: 40, height: 40, flexShrink: 0, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  chevron: { flexShrink: 0 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
