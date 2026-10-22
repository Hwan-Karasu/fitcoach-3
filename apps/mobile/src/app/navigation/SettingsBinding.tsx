import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ToastAndroid } from "react-native";
import { GroupVisibilityPreferenceProvider, type GroupVisibilityPreference } from "../../features/measurements/public.ts";
import type { AppearanceSetting, SettingsPort } from "../../features/settings/public.ts";
import { PrototypeThemeProvider, type ThemePersistence } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";

/** Z01: тема и акцент читаются до первого кадра, чтобы не мигала тема по умолчанию; сбой чтения — тема по умолчанию. */
export function SettingsBinding({ settings, children }: Readonly<{ settings: SettingsPort; children: ReactNode }>) {
  const [appearance, setAppearance] = useState<AppearanceSetting | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    settings.readAppearance().then((value) => { if (active) setAppearance(value); }, () => { if (active) setAppearance(null); });
    return () => { active = false; };
  }, [settings]);
  const persistence = useMemo<ThemePersistence | undefined>(() => appearance === undefined ? undefined : {
    initial: appearance,
    // Выбор действует сразу; если сохранить не удалось, об этом сообщается — после перезапуска оформление вернётся прежним.
    onChange: (value) => { settings.saveAppearance(value).catch(() => ToastAndroid.show("Не удалось сохранить оформление", ToastAndroid.LONG)); },
  }, [appearance, settings]);
  const groups = useMemo<GroupVisibilityPreference>(() => ({
    load: () => settings.readMeasurementGroups(),
    save: (ids) => settings.saveMeasurementGroups(ids),
  }), [settings]);
  if (persistence === undefined) return null;
  return (
    <PrototypeThemeProvider persistence={persistence}>
      <GroupVisibilityPreferenceProvider value={groups}>{children}</GroupVisibilityPreferenceProvider>
    </PrototypeThemeProvider>
  );
}
