import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { EmptyState, InlineNotice } from "../components/public.ts";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

export function PrototypeScreen({
  title,
  description,
  children,
}: Readonly<{ title?: string; description?: string; children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={styles.screenContent}
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
  pageTitle: { fontSize: 22, lineHeight: 28, fontWeight: "700" },
  description: { fontSize: 14, lineHeight: 20 },
  sectionHeading: { fontSize: 16, lineHeight: 22, fontWeight: "700", marginTop: 8 },
  link: { minHeight: 64, borderWidth: 2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  linkText: { flex: 1, gap: 3 },
  linkTitle: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  linkDetail: { fontSize: 12, lineHeight: 16 },
  chevron: { fontSize: 26, lineHeight: 28 },
});
