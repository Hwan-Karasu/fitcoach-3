import { useEffect, useRef, type RefObject } from "react";
import { Animated, BackHandler, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Bell, Menu, Search, Settings, X } from "lucide-react-native";
import { AppIconButton, BrandMark, ScreenHeader, SCREEN_HEADER_HEIGHT } from "../../shared/ui/components/public.ts";
import { useUnreadNotifications } from "./NotificationsHost.tsx";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { appBrandName } from "./routeCatalog.ts";

/** Поиск вкладки в шапке (UI-OWN-019): лупа рядом с колокольчиком раскрывает поле на всю строку. */
export interface RootHeaderSearch {
  readonly open: boolean;
  readonly query: string;
  readonly placeholder: string;
  readonly onOpen: () => void;
  readonly onChangeQuery: (value: string) => void;
  /** Закрыть поиск и сбросить текст. */
  readonly onClose: () => void;
}

/**
 * Одна строка шапки корневой вкладки (UI-OWN-001/016): вверху — знак и название приложения,
 * при прокрутке — название раздела; справа поиск, колокольчик и меню. Та же карточка и высота, что у остальных
 * экранов (UI-OWN-035); отступ сверху уже даёт RootTabs.
 */
export function RootHeader({
  title,
  collapsed,
  search,
  onOpenNotifications,
  onOpenMenu,
  menuButtonRef,
  onOpenSettings,
  onBack,
}: Readonly<{ title: string; collapsed: boolean; search?: RootHeaderSearch; onOpenNotifications: () => void;
  onOpenMenu: () => void; menuButtonRef: RefObject<View | null>;
  /** Настройки раздела (шестерёнка календаря) — в одном ряду с колокольчиком и меню. */
  onOpenSettings?: () => void; onBack?: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const unreadNotifications = useUnreadNotifications();
  const progress = useRef(new Animated.Value(collapsed ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, { toValue: collapsed ? 1 : 0, duration: 160, useNativeDriver: true }).start();
  }, [collapsed, progress]);
  const brandStyle = {
    opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, -8] }) }],
  };
  const titleStyle = {
    opacity: progress,
    transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
  };
  // Системная «Назад» сначала закрывает поиск.
  const closeSearch = search?.open ? search.onClose : null;
  useEffect(() => {
    if (closeSearch === null) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { closeSearch(); return true; });
    return () => subscription.remove();
  }, [closeSearch]);

  if (search?.open) {
    return (
      <ScreenHeader insetTop={false} onBack={search.onClose}>
        <View style={[styles.searchField, { backgroundColor: colors.input, borderColor: colors.focusRing }]}>
          <Search size={18} color={colors.textMuted} strokeWidth={2} />
          <TextInput autoFocus value={search.query} onChangeText={search.onChangeQuery} placeholder={search.placeholder}
            placeholderTextColor={colors.textMuted} selectionColor={colors.accentInk} returnKeyType="search"
            accessibilityLabel={search.placeholder} style={[styles.searchInput, { color: colors.textPrimary }]} />
          {search.query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Очистить поиск" hitSlop={8}
              onPress={() => search.onChangeQuery("")} style={styles.clear}>
              <X size={18} color={colors.textSecondary} strokeWidth={2} />
            </Pressable>
          ) : null}
        </View>
      </ScreenHeader>
    );
  }

  return (
    <ScreenHeader insetTop={false} onBack={onBack} right={<>
      {onOpenSettings ? (
        <AppIconButton compact label={`Настройки: ${title.toLowerCase()}`}
          icon={<Settings size={20} color={colors.textPrimary} strokeWidth={1.8} />} onPress={onOpenSettings} />
      ) : null}
      {search ? (
        <AppIconButton compact label={search.placeholder} icon={<Search size={20} color={colors.textPrimary} strokeWidth={1.8} />}
          onPress={search.onOpen} />
      ) : null}
      <AppIconButton
        compact
        label="Открыть центр уведомлений"
        badgeCount={unreadNotifications}
        icon={<Bell size={20} color={colors.textPrimary} strokeWidth={1.8} />}
        onPress={onOpenNotifications}
        testID="open-notifications"
      />
      <AppIconButton
        compact
        label="Открыть главное меню"
        buttonRef={menuButtonRef}
        icon={<Menu size={20} color={colors.textPrimary} strokeWidth={1.8} />}
        onPress={onOpenMenu}
        testID="open-menu"
      />
    </>}>
      {onBack ? <Text accessibilityRole="header" numberOfLines={2} style={[styles.nestedTitle, { color: colors.textPrimary }]}>{title}</Text> : <View accessible accessibilityRole="header" accessibilityLabel={`${appBrandName}, ${title}`} style={styles.titleSlot}>
        <Animated.View style={[styles.layer, brandStyle]}>
          <BrandMark size={24} color={colors.accentInk} />
          <Animated.Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.brand, { color: colors.textPrimary }]}>{appBrandName}</Animated.Text>
        </Animated.View>
        <Animated.View style={[styles.layer, titleStyle]}>
          <Animated.Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{title}</Animated.Text>
        </Animated.View>
      </View>}
    </ScreenHeader>
  );
}

const styles = StyleSheet.create({
  nestedTitle: { flex: 1, minWidth: 0, fontFamily: fonts.bold, fontSize: 13, lineHeight: 17 },
  titleSlot: { flex: 1, height: SCREEN_HEADER_HEIGHT - 2, marginLeft: 4 },
  layer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  title: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 18, lineHeight: 23 },
  searchField: { flex: 1, height: 40, marginRight: 4, borderWidth: 1, borderRadius: 10, paddingLeft: 10, paddingRight: 2,
    flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 0 },
  clear: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
