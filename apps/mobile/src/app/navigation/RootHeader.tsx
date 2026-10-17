import { useEffect, useRef, type RefObject } from "react";
import { Animated, BackHandler, Pressable, StyleSheet, TextInput, View } from "react-native";
import { ArrowLeft, Bell, Menu, Search, Settings, X } from "lucide-react-native";
import { AppIconButton, BrandMark } from "../../shared/ui/components/public.ts";
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
 * при прокрутке — название раздела; справа поиск, колокольчик и меню.
 */
export function RootHeader({
  title,
  collapsed,
  search,
  onOpenNotifications,
  onOpenMenu,
  menuButtonRef,
  onOpenSettings,
}: Readonly<{ title: string; collapsed: boolean; search?: RootHeaderSearch; onOpenNotifications: () => void;
  onOpenMenu: () => void; menuButtonRef: RefObject<View | null>;
  /** Настройки раздела (шестерёнка календаря) — в одном ряду с колокольчиком и меню. */
  onOpenSettings?: () => void }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
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
  const frame = [styles.header, { backgroundColor: colors.canvas, borderBottomColor: collapsed ? colors.border : "transparent" }];

  if (search?.open) {
    return (
      <View style={[frame, styles.searchMode]}>
        <AppIconButton label="Закрыть поиск" icon={<ArrowLeft size={22} color={colors.textPrimary} strokeWidth={1.8} />}
          onPress={search.onClose} />
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
      </View>
    );
  }

  return (
    <View style={frame}>
      <View accessible accessibilityRole="header" accessibilityLabel={`${appBrandName}, ${title}`} style={styles.titleSlot}>
        <Animated.View style={[styles.layer, brandStyle]}>
          <BrandMark size={28} color={colors.accentInk} />
          <Animated.Text numberOfLines={1} style={[styles.brand, { color: colors.textPrimary }]}>{appBrandName}</Animated.Text>
        </Animated.View>
        <Animated.View style={[styles.layer, titleStyle]}>
          <Animated.Text numberOfLines={1} style={[styles.title, { color: colors.textPrimary }]}>{title}</Animated.Text>
        </Animated.View>
      </View>
      {onOpenSettings ? (
        <AppIconButton compact label={`Настройки: ${title.toLowerCase()}`}
          icon={<Settings size={22} color={colors.textPrimary} strokeWidth={1.8} />} onPress={onOpenSettings} />
      ) : null}
      {search ? (
        <AppIconButton compact label={search.placeholder} icon={<Search size={22} color={colors.textPrimary} strokeWidth={1.8} />}
          onPress={search.onOpen} />
      ) : null}
      <AppIconButton
        compact
        label="Открыть центр уведомлений"
        icon={<Bell size={22} color={colors.textPrimary} strokeWidth={1.8} />}
        onPress={onOpenNotifications}
        testID="open-notifications"
      />
      <AppIconButton
        compact
        label="Открыть главное меню"
        buttonRef={menuButtonRef}
        icon={<Menu size={22} color={colors.textPrimary} strokeWidth={1.8} />}
        onPress={onOpenMenu}
        testID="open-menu"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 56, paddingLeft: 16, paddingRight: 4, flexDirection: "row", alignItems: "center", borderBottomWidth: 1 },
  searchMode: { paddingLeft: 4 },
  titleSlot: { flex: 1, height: 56 },
  layer: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  brand: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 19, lineHeight: 25 },
  title: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
  searchField: { flex: 1, height: 44, marginRight: 12, borderWidth: 1, borderRadius: 8, paddingLeft: 10, paddingRight: 2,
    flexDirection: "row", alignItems: "center", gap: 8 },
  searchInput: { flex: 1, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 0 },
  clear: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
