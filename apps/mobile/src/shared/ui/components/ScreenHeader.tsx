import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft } from "lucide-react-native";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";
import { AppIconButton } from "./AppIconButton.tsx";

/** Высота карточки шапки — одна на всех экранах (UI-OWN-035). */
export const SCREEN_HEADER_HEIGHT = 56;

/**
 * Шапка экрана — карточка одной высоты на всех экранах (UI-OWN-035, макет владельца): «←», знак (аватар клиента),
 * заголовок и подзаголовок, справа действия. `insetTop: false` — для вложенного стека, где отступ уже есть.
 */
export function ScreenHeader({ title, subtitle, mark, onBack, right, insetTop = true, children }: Readonly<{
  title?: string;
  subtitle?: string;
  /** Аватар: эмодзи или инициалы клиента. */
  mark?: string;
  onBack?: () => void;
  right?: ReactNode;
  insetTop?: boolean;
  /** Своё содержимое вместо заголовка (главная шапка: знак приложения, поиск). */
  children?: ReactNode;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.outer, { backgroundColor: colors.canvas, paddingTop: (insetTop ? insets.top : 0) + 6 }]}>
      <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {onBack !== undefined ? <AppIconButton compact label="Назад"
          icon={<ArrowLeft size={21} color={colors.textPrimary} strokeWidth={1.9} />} onPress={onBack} /> : <View style={styles.gap} />}
        {children ?? <>
          {mark !== undefined ? (
            <View style={[styles.mark, { backgroundColor: colors.surfaceRaised }]}>
              <Text numberOfLines={1} style={[styles.markText, { color: colors.accentInk }]}>{mark}</Text>
            </View>
          ) : null}
          <View accessible accessibilityRole="header" accessibilityLabel={[title, subtitle].filter(Boolean).join(", ")} style={styles.text}>
            {title !== undefined ? <Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{title}</Text> : null}
            {subtitle !== undefined ? <Text numberOfLines={1} style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text> : null}
          </View>
        </>}
        {right}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { paddingHorizontal: 12, paddingBottom: 6 },
  card: { height: SCREEN_HEADER_HEIGHT, flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 14,
    paddingHorizontal: 4, overflow: "hidden" },
  gap: { width: 6 },
  mark: { width: 38, height: 38, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  markText: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  text: { flex: 1, minWidth: 0, justifyContent: "center", paddingLeft: 2 },
  title: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 19 },
  subtitle: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 15 },
});
