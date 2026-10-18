import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, NumericField, SelectionChip } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ClientRosterPort, RosterBirthdaySettings } from "../domain/ClientRosterPort.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

export function ClientRosterSettingsScreen({ repository }: Readonly<{
  repository: ClientRosterPort;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [saved, setSaved] = useState<RosterBirthdaySettings | null>(null);
  const [pinEnabled, setPinEnabled] = useState(true);
  const [badgeEnabled, setBadgeEnabled] = useState(true);
  const [leadDays, setLeadDays] = useState("14");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);

  useFocusEffect(useCallback(() => {
    let active = true;
    void repository.getBirthdaySettings().then((settings) => {
      if (!active) return;
      setSaved(settings);
      setPinEnabled(settings.birthdayPinEnabled);
      setBadgeEnabled(settings.showBirthdayBadge);
      setLeadDays(String(settings.birthdayPinLeadDays));
      setError(null);
    }).catch(() => { if (active) setError("Не удалось загрузить настройки списка."); });
    return () => { active = false; };
  }, [repository]));

  const lead = /^\d{1,2}$/u.test(leadDays) ? Number(leadDays) : NaN;
  const leadError = saved !== null && (!Number.isSafeInteger(lead) || lead < 1 || lead > 60)
    ? "Введите целое число от 1 до 60." : undefined;
  const dirty = saved !== null && (pinEnabled !== saved.birthdayPinEnabled
    || badgeEnabled !== saved.showBirthdayBadge || lead !== saved.birthdayPinLeadDays);

  const save = async () => {
    if (savingRef.current || saved === null || leadError !== undefined || !dirty) return;
    savingRef.current = true;
    setBusy(true);
    const next: RosterBirthdaySettings = {
      birthdayPinEnabled: pinEnabled, birthdayPinLeadDays: lead, showBirthdayBadge: badgeEnabled,
    };
    try {
      await repository.setBirthdaySettings(next);
      setSaved(next);
      setError(null);
    } catch { setError("Не удалось сохранить настройки. Попробуйте ещё раз."); }
    finally { savingRef.current = false; setBusy(false); }
  };

  return (
    <PrototypeScreen description="Настройки списка клиентов в этом рабочем пространстве.">
      <SectionHeading>Дни рождения</SectionHeading>
      {saved === null && error === null ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>Загружаем настройки…</Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>{error}</Text> : null}
      {saved === null ? <AppButton variant="secondary" label="Повторить"
        onPress={() => { void repository.getBirthdaySettings().then((settings) => {
          setSaved(settings);
          setPinEnabled(settings.birthdayPinEnabled);
          setBadgeEnabled(settings.showBirthdayBadge);
          setLeadDays(String(settings.birthdayPinLeadDays));
          setError(null);
        }).catch(() => setError("Не удалось загрузить настройки списка.")); }} /> : null}
      {saved !== null ? <>
        <Text style={[styles.label, { color: colors.textPrimary }]}>Закреплять перед днём рождения</Text>
        <View style={styles.choices}>
          <SelectionChip group="Закрепление дня рождения" label="Включено" selected={pinEnabled}
            onPress={() => setPinEnabled(true)} />
          <SelectionChip group="Закрепление дня рождения" label="Выключено" selected={!pinEnabled}
            onPress={() => setPinEnabled(false)} />
        </View>
        <NumericField label="Закреплять за" unit="дней до дня рождения"
          decimalPolicy="integer" rawValue={leadDays} onChangeRawValue={setLeadDays}
          hint="От 1 до 60 дней; значение сохранится и при выключенном закреплении."
          error={leadError} />
        <Text style={[styles.label, { color: colors.textPrimary }]}>Показывать короткий значок «ДР»</Text>
        <View style={styles.choices}>
          <SelectionChip group="Значок дня рождения" label="Включено" selected={badgeEnabled}
            onPress={() => setBadgeEnabled(true)} />
          <SelectionChip group="Значок дня рождения" label="Выключено" selected={!badgeEnabled}
            onPress={() => setBadgeEnabled(false)} />
        </View>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          Значок появляется за 7 дней до даты и не зависит от закрепления.
        </Text>
        <AppButton label="Сохранить" disabled={!dirty || leadError !== undefined || busy}
          onPress={() => { void save(); }} />
      </> : null}
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  message: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
