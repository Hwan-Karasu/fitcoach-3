import { useCallback, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, Switch, Text, View } from "react-native";
import { AppButton, NumericField, SelectionChip } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ClientRosterPort, RosterBirthdaySettings } from "../domain/ClientRosterPort.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { CLIENT_METRICS, CLIENT_START_SECTIONS } from "../../../shared/domain/ClientCardPreference.ts";

export function ClientRosterSettingsScreen({ repository }: Readonly<{
  repository: ClientRosterPort;
}>) {
  const { palette, clientCards, setClientCards, navigationAppearance, setNavigationAppearance } = usePrototypeTheme();
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
    <PrototypeScreen compact>
      <View style={[styles.block, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <SectionHeading>При входе в карточку</SectionHeading>
      {Array.from({ length: Math.ceil(CLIENT_START_SECTIONS.length / 2) }, (_, row) => <View key={row} style={styles.choices}>
        {CLIENT_START_SECTIONS.slice(row * 2, row * 2 + 2).map((option) => <SelectionChip compact fill key={option.id}
          group="Начальный раздел карточки" label={option.label} selected={clientCards.startSection === option.id}
          onPress={() => setClientCards({ startSection: option.id })} />)}
      </View>)}
      </View>
      <View style={[styles.block, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <SectionHeading>Плитки в списке · {clientCards.metricIds.length}/4</SectionHeading>
      {Array.from({ length: Math.ceil(CLIENT_METRICS.length / 2) }, (_, row) => <View key={row} style={styles.choices}>
        {CLIENT_METRICS.slice(row * 2, row * 2 + 2).map((option) => <SelectionChip compact fill key={option.id}
          group="Плитки клиента" label={option.label} selected={clientCards.metricIds.includes(option.id)}
          disabled={!clientCards.metricIds.includes(option.id) && clientCards.metricIds.length >= 4}
          disabledReason="Можно выбрать до четырёх плиток"
          onPress={() => setClientCards({ metricIds: clientCards.metricIds.includes(option.id)
            ? clientCards.metricIds.filter((id) => id !== option.id) : [...clientCards.metricIds, option.id] })} />)}
      </View>)}
      <Text style={[styles.message, { color: colors.textSecondary }]}>Порядок плиток — по порядку включения.</Text>
      <View style={styles.toggleRow}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>Значок ограничений здоровья</Text>
        <Switch accessibilityLabel="Показывать ограничения здоровья" value={clientCards.showHealthBadge}
          onValueChange={(showHealthBadge) => setClientCards({ showHealthBadge })}
          trackColor={{ false: colors.border, true: colors.accentFill }} thumbColor={colors.surface} />
      </View>
      </View>
      <View style={[styles.block, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <SectionHeading>Навигация карточки</SectionHeading>
      <View style={styles.toggleRow}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>К списку клиентов</Text>
        <Switch accessibilityLabel="Показывать кнопку К списку клиентов" value={navigationAppearance.showClientListShortcut}
          onValueChange={(enabled) => setNavigationAppearance("showClientListShortcut", enabled)}
          trackColor={{ false: colors.border, true: colors.accentFill }} thumbColor={colors.surface} />
      </View>
      <View style={styles.toggleRow}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>Подписи кнопок навигации</Text>
        <Switch accessibilityLabel="Показывать подписи кнопок навигации" value={!navigationAppearance.hideNavigationLabels}
          onValueChange={(enabled) => setNavigationAppearance("hideNavigationLabels", !enabled)}
          trackColor={{ false: colors.border, true: colors.accentFill }} thumbColor={colors.surface} />
      </View>
      </View>
      <View style={[styles.block, { backgroundColor: colors.surface, borderColor: colors.border }]}>
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
          <SelectionChip fill group="Закрепление дня рождения" label="Включено" selected={pinEnabled}
            onPress={() => setPinEnabled(true)} />
          <SelectionChip fill group="Закрепление дня рождения" label="Выключено" selected={!pinEnabled}
            onPress={() => setPinEnabled(false)} />
        </View>
        <NumericField label="Закреплять за" unit="дней до дня рождения"
          decimalPolicy="integer" rawValue={leadDays} onChangeRawValue={setLeadDays}
          hint="От 1 до 60 дней; значение сохранится и при выключенном закреплении."
          error={leadError} />
        <Text style={[styles.label, { color: colors.textPrimary }]}>Показывать короткий значок «ДР»</Text>
        <View style={styles.choices}>
          <SelectionChip fill group="Значок дня рождения" label="Включено" selected={badgeEnabled}
            onPress={() => setBadgeEnabled(true)} />
          <SelectionChip fill group="Значок дня рождения" label="Выключено" selected={!badgeEnabled}
            onPress={() => setBadgeEnabled(false)} />
        </View>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          Значок появляется за 7 дней до даты и не зависит от закрепления.
        </Text>
        <AppButton label="Сохранить" disabled={!dirty || leadError !== undefined || busy}
          onPress={() => { void save(); }} />
      </> : null}
      </View>
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  block: { borderWidth: 1, borderRadius: 18, padding: 12, gap: 8, marginBottom: 4 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  toggleLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  choices: { flexDirection: "row", gap: 8 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  message: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
