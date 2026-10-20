import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyState, InlineNotice } from "../components/public.ts";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export function PrototypeScreen({
  title,
  description,
  compact = false,
  children,
}: Readonly<{ title?: string; description?: string; children: ReactNode; /** Плотная компоновка (главная клиента): меньшие отступы, чтобы блоки помещались без прокрутки. */ compact?: boolean }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={compact ? styles.screenContentCompact : styles.screenContent}
      keyboardShouldPersistTaps="handled"
    >
      {title ? <Text style={[styles.pageTitle, { color: colors.textPrimary }]}>{title}</Text> : null}
      {description ? <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text> : null}
      {children}
    </ScrollView>
  );
}

export function PrototypeNotice({ children }: Readonly<{ children: ReactNode }>) {
  return <InlineNotice kind="info">{children}</InlineNotice>;
}

export function EmptyPanel({ title, body }: Readonly<{ title: string; body: string }>) {
  return <EmptyState reason="unavailable" title={title} body={body} />;
}

export function SectionHeading({ children }: Readonly<{ children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  return <Text style={[styles.sectionHeading, { color: palette.tokens.textPrimary }]}>{children}</Text>;
}

export function PrototypeLink({
  title,
  detail,
  onPress,
}: Readonly<{ title: string; detail?: string; onPress: () => void }>) {
  const [focused, setFocused] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => [styles.link, {
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface,
        borderColor: focused ? colors.focusRing : colors.border,
      }]}
    >
      <View style={styles.linkText}>
        <Text style={[styles.linkTitle, { color: colors.textPrimary }]}>{title}</Text>
        {detail ? <Text style={[styles.linkDetail, { color: colors.textSecondary }]}>{detail}</Text> : null}
      </View>
      <Text style={[styles.chevron, { color: colors.accentInk }]}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screenContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 36, gap: 12 },
  // flexGrow: дочерний блок может занять свободную высоту, а последний элемент прижимается к низу экрана.
  screenContentCompact: { flexGrow: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 6 },
  pageTitle: { fontSize: 18, lineHeight: 23, fontFamily: fonts.bold },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  sectionHeading: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, marginTop: 8 },
  link: { minHeight: 64, borderWidth: 2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  linkText: { flex: 1, gap: 3 },
  linkTitle: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  linkDetail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  chevron: { fontFamily: fonts.regular, fontSize: 20, lineHeight: 26 },
});
