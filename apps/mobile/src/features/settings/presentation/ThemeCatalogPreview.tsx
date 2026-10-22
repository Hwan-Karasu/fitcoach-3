import { useEffect, useState } from "react";
import { AccessibilityInfo, BackHandler, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { appThemes as catalogThemes } from "../../../shared/ui/theme/themes.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { AccentSwatch } from "../../../shared/ui/theme/AccentSwatch.tsx";
import { ThemeCard } from "../../../shared/ui/theme/ThemeCard.tsx";
import { ThemePreviewPanel } from "../../../shared/ui/theme/ThemePreviewPanel.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";

export function ThemeCatalogPreview({ onClose }: Readonly<{ onClose: () => void }>) {
  const [backFocused, setBackFocused] = useState(false);
  const { palette, selectTheme, selectAccent } = usePrototypeTheme();
  const selectedTheme = catalogThemes.find((theme) => theme.id === palette.themeId) ?? catalogThemes[0];
  const colors = palette.tokens;
  const chooseTheme = (theme: typeof catalogThemes[number]) => {
    if (theme.id === palette.themeId) return;
    selectTheme(theme.id);
    AccessibilityInfo.announceForAccessibility(`Выбрана тема ${theme.name}. Акцент по умолчанию.`);
  };
  const chooseAccent = (accent: typeof catalogThemes[number]["accentSwatches"][number]) => {
    if (accent.id === palette.accentId) return;
    selectAccent(accent.id);
    AccessibilityInfo.announceForAccessibility(`Выбран акцент ${accent.name}.`);
  };

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose]);

  return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
        <StatusBar barStyle={palette.tone === "dark" ? "light-content" : "dark-content"} backgroundColor={colors.canvas} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Вернуться к настройкам"
            onPress={onClose}
            onFocus={() => setBackFocused(true)}
            onBlur={() => setBackFocused(false)}
            style={({ pressed }) => [styles.backButton, {
              borderColor: backFocused ? colors.focusRing : "transparent",
              backgroundColor: pressed ? colors.surfaceRaised : "transparent",
            }]}
          >
            <Text style={[styles.backText, { color: colors.accentInk }]}>← Назад</Text>
          </Pressable>

          <Text style={[styles.eyebrow, { color: colors.accentInk }]}>ОФОРМЛЕНИЕ</Text>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Каталог оформления</Text>
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            Девять готовых тем и три совместимых акцента для каждой. Выбор виден сразу во всём приложении и сохраняется между запусками.
          </Text>

          <ThemePreviewPanel />

          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>Акцент · {palette.accentName}</Text>
          <View style={styles.accentList}>
            {selectedTheme.accentSwatches.map((accent) => (
              <AccentSwatch
                key={accent.id}
                accent={accent}
                selected={accent.id === palette.accentId}
                palette={colors}
                onPress={() => chooseAccent(accent)}
              />
            ))}
          </View>

          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>Готовые темы</Text>
          <View style={styles.themeList}>
            {catalogThemes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                selected={theme.id === palette.themeId}
                selectedAccentId={theme.id === palette.themeId ? palette.accentId : undefined}
                onPress={() => chooseTheme(theme)}
              />
            ))}
          </View>
          <Text style={[styles.footer, { color: colors.textMuted }]}>
            Точные цвета и расположение ещё проходят Android/UI-проверку. Этот экран — разработческий предпросмотр, не готовые настройки.
          </Text>
        </ScrollView>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40, gap: 12 },
  backButton: { minWidth: 48, minHeight: 48, borderWidth: 2, borderRadius: 8, paddingHorizontal: 8, alignSelf: "flex-start", justifyContent: "center" },
  backText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  eyebrow: { fontSize: 11, lineHeight: 14, fontFamily: fonts.bold, letterSpacing: 1.2 },
  title: { fontSize: 18, lineHeight: 23, fontFamily: fonts.bold },
  description: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  sectionTitle: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold, marginTop: 8 },
  accentList: { gap: 8 },
  themeList: { gap: 10 },
  footer: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 8 },
});
