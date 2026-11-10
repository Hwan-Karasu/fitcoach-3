import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text } from "react-native";
import { EmptyState, InlineNotice } from "../components/public.ts";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";
import { fonts } from "../theme/typography.ts";

export function PrototypeScreen({
  title,
  description,
  compact = false,
  mockup = false,
  scroll = true,
  children,
}: Readonly<{ title?: string; description?: string; children: ReactNode; /** Плотная компоновка (главная клиента): меньшие отступы, чтобы блоки помещались без прокрутки. */ compact?: boolean;
  /** Отступы макета OnlyFits: поля 16, между карточками 8 (карточка клиента). */ mockup?: boolean;
  /**
   * `false` — прокрутка только при нехватке высоты (главная клиента): обычно экран неподвижен, но если содержимое выше экрана
   * (другое состояние абонемента, крупный шрифт, маленький экран), нижние блоки остаются доступны.
   */ scroll?: boolean }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [viewport, setViewport] = useState(0);
  const [content, setContent] = useState(0);
  const contentStyle = mockup ? styles.screenContentMockup : compact ? styles.screenContentCompact : styles.screenContent;
  const heading = <>
    {title ? <Text style={[styles.pageTitle, { color: colors.textPrimary }]}>{title}</Text> : null}
    {description ? <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text> : null}
  </>;
  if (!scroll) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: colors.canvas }} contentContainerStyle={contentStyle}
        keyboardShouldPersistTaps="handled" scrollEnabled={content > viewport + 1} bounces={false} overScrollMode="never"
        onLayout={(event) => setViewport(event.nativeEvent.layout.height)} onContentSizeChange={(_width, height) => setContent(height)}>
        {heading}
        {children}
      </ScrollView>
    );
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.canvas }}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
    >
      {heading}
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

const styles = StyleSheet.create({
  screenContent: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 36, gap: 12 },
  // flexGrow: дочерний блок может занять свободную высоту, а последний элемент прижимается к низу экрана.
  screenContentCompact: { flexGrow: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12, gap: 6 },
  screenContentMockup: { flexGrow: 1, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, gap: 8 },
  pageTitle: { fontSize: 18, lineHeight: 23, fontFamily: fonts.bold },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  sectionHeading: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, marginTop: 8 },
});
