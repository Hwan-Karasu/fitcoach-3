import { useEffect, useState } from "react";
import { AccessibilityInfo, BackHandler, Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { appThemes as catalogThemes } from "../../../shared/ui/theme/themes.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { ThemeCard } from "../../../shared/ui/theme/ThemeCard.tsx";
import { ThemePreviewPanel } from "../../../shared/ui/theme/ThemePreviewPanel.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";

export function ThemeCatalogPreview({ onClose }: Readonly<{ onClose: () => void }>) {
  const [backFocused, setBackFocused] = useState(false);
  const { palette, selectTheme } = usePrototypeTheme();
  const colors = palette.tokens;
  const chooseTheme = (theme: typeof catalogThemes[number]) => {
    if (theme.id === palette.themeId) return;
    selectTheme(theme.id);
    AccessibilityInfo.announceForAccessibility(`Выбрана тема ${theme.name}. Акцент по умолчанию.`);
  };
  const chooseAccent = (theme: typeof catalogThemes[number], accentId: string) => {
    if (theme.id === palette.themeId && accentId === palette.accentId) return;
    const accent = theme.accentSwatches.find((candidate) => candidate.id === accentId);
    if (!accent) return;
    selectTheme(theme.id, accent.id);
    AccessibilityInfo.announceForAccessibility(`${theme.name}. Акцент ${accent.name}.`);
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
          <View style={styles.header}>
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
            <Text style={[styles.backText, { color: colors.accentInk }]}>←</Text>
          </Pressable>

          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Оформление</Text>
          </View>

          <ThemePreviewPanel />

          <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>Готовые темы</Text>
          <View style={styles.themeList}>
            {[0, 2, 4].map((start) => <View key={catalogThemes[start]!.id} style={styles.themeRow}>
            {catalogThemes.slice(start, start + 2).map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                selected={theme.id === palette.themeId}
                selectedAccentId={theme.id === palette.themeId ? palette.accentId : undefined}
                onPress={() => chooseTheme(theme)}
                onSelectAccent={(accentId) => chooseAccent(theme, accentId)}
              />
            ))}
            </View>)}
          </View>
        </ScrollView>
      </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 6, gap: 6 },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  backButton: { minWidth: 44, minHeight: 44, borderWidth: 2, borderRadius: 8, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  backText: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  title: { fontSize: 18, lineHeight: 23, fontFamily: fonts.bold },
  sectionTitle: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  themeList: { gap: 6 },
  themeRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
});
