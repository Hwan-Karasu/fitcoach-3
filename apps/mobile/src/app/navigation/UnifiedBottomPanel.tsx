import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RestTimerDock } from "../../features/training/public.ts";
import { useBottomPanelContent } from "../../shared/ui/components/public.ts";
import { panelBottomPadding } from "../../shared/ui/components/bottomPanelRules.ts";
import { PaletteOverride, usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { navigationBorder } from "../../shared/ui/theme/navigationBorder.ts";
import type { ApplicationServices } from "../composition/createServices.ts";
import { restTimerDiagnostics } from "../../shared/diagnostics/RestTimerDiagnostics.ts";

/** Общий контейнер живёт рядом со стеком, а не внутри меняющихся карточек клиентов. */
export function UnifiedBottomPanel({ services, onOpen }: Readonly<{
  services: ApplicationServices;
  onOpen: React.ComponentProps<typeof RestTimerDock>["onOpen"];
}>) {
  restTimerDiagnostics.render("panel");
  const entry = useBottomPanelContent();
  const { palette } = usePrototypeTheme();
  const colors = entry?.tokens ?? palette.tokens;
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const avatarOwners = useRef<ReadonlySet<string>>(new Set());
  const [avatarVersion, setAvatarVersion] = useState(0);
  useEffect(() => services.clients.subscribeCommittedChanges((change) => {
    if (change.clientId === null || avatarOwners.current.has(change.clientId)) setAvatarVersion((value) => value + 1);
  }), [services.clients]);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);
  const avatars = useCallback(async (ids: readonly string[]) => {
    avatarOwners.current = new Set(ids);
    return new Map(await Promise.all(ids.map(async (id) => {
      const client = await services.clients.get(id).catch(() => null);
      return [id, client?.emoji ?? null] as const;
    })));
  }, [services.clients, avatarVersion]);
  const bottom = panelBottomPadding(insets.bottom, keyboardVisible);
  // Без панели и таймеров остаётся полоса высотой в системный отступ: экраны без своей панели (футеры, Excel, оформление) сами нижний inset не добавляют, полоса его заменяет.
  const render = (area: ReactNode, hasTimers: boolean) => entry === null && !hasTimers
    ? <View style={{ height: bottom, backgroundColor: colors.canvas }} />
    : <View testID="unified-bottom-panel"
        style={[styles.panel, { paddingBottom: bottom, backgroundColor: colors.navigation, borderTopColor: navigationBorder(colors) }]}>
        {area}
        {entry?.participants}
        {entry?.navigation}
      </View>;
  return <PaletteOverride tokens={colors}>
    <RestTimerDock timers={services.restTimers} onOpen={onOpen} loadAvatars={avatars} renderContainer={render} />
  </PaletteOverride>;
}

const styles = StyleSheet.create({ panel: {
  borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTopWidth: 1,
  paddingTop: 4, paddingHorizontal: 8, gap: 2,
} });
