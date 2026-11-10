import { useCallback, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, NumericField, SelectionChip, AppSwitch } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { shadow } from "../../../shared/ui/theme/style.ts";
import type { ClientRosterPort, RosterBirthdaySettings } from "../domain/ClientRosterPort.ts";
import { parseBirthdayLeadDays } from "../domain/BirthdaySettingsRules.ts";
import { BirthdaySettingsSaveQueue } from "./BirthdaySettingsSaveQueue.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { CLIENT_METRICS, CLIENT_START_SECTIONS } from "../../../shared/domain/ClientCardPreference.ts";

/**
 * «Список и карточки клиентов»: начальный раздел, плитки, панель навигации и дни рождения. Кнопки «Сохранить» нет (UIX-13, решение владельца 2026-11-09):
 * переключатели пишутся сразу, число дней — при уходе с поля и при выходе с экрана, если оно корректно (иначе ошибка под полем, запись не выполняется).
 * Записи идут по очереди; при сбое значения перечитываются из хранилища.
 */
export function ClientRosterSettingsScreen({ repository }: Readonly<{
  repository: ClientRosterPort;
}>) {
  const { palette, clientCards, setClientCards, navigationAppearance, setNavigationAppearance } = usePrototypeTheme();
  const colors = palette.tokens;
  const [saved, setSaved] = useState<RosterBirthdaySettings | null>(null);
  const [leadDays, setLeadDays] = useState("14");
  const [leadInvalid, setLeadInvalid] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef<RosterBirthdaySettings | null>(null);
  const queue = useMemo(() => new BirthdaySettingsSaveQueue(repository), [repository]);
  const leadRef = useRef(leadDays);
  leadRef.current = leadDays;

  const adopt = useCallback((settings: RosterBirthdaySettings) => {
    savedRef.current = settings;
    setSaved(settings);
    setLeadDays(String(settings.birthdayPinLeadDays));
    setLeadInvalid(false);
  }, []);
  const load = useCallback(() => queue.load().then((settings) => { adopt(settings); setError(null); },
    () => setError("Не удалось загрузить настройки списка.")), [queue, adopt]);

  /** Запись изменения сразу; сбой — сообщение и перечитывание сохранённого, чтобы экран не показывал то, чего нет в хранилище. */
  const commit = useCallback((patch: Partial<RosterBirthdaySettings>) => {
    const write = queue.commit(patch);
    if (write === null) return;
    savedRef.current = write.next;
    setSaved(write.next);
    void write.result.then(() => {
      if (!queue.isLatest(write.sequence)) return;
      savedRef.current = queue.value; setSaved(queue.value); setError(null);
    }, () => {
      if (!queue.isLatest(write.sequence)) return;
      savedRef.current = queue.value; setSaved(queue.value);
      setError("Не удалось сохранить настройки. Попробуйте ещё раз.");
    });
  }, [queue]);

  /** Число дней: корректное — пишется, некорректное — ошибка под полем без записи. */
  const commitLead = useCallback(() => {
    const days = parseBirthdayLeadDays(leadRef.current);
    if (days === null) { setLeadInvalid(true); return; }
    setLeadInvalid(false);
    commit({ birthdayPinLeadDays: days });
  }, [commit]);

  useFocusEffect(useCallback(() => {
    void load();
    // Выход с экрана с набранным, но не покинутым полем: корректное значение сохраняется.
    return () => { if (savedRef.current !== null && parseBirthdayLeadDays(leadRef.current) !== null) commit({ birthdayPinLeadDays: parseBirthdayLeadDays(leadRef.current) as number }); };
  }, [load, commit]));

  const block = [styles.block, shadow.card, { backgroundColor: colors.surface }];
  return (
    <PrototypeScreen compact>
      <View style={block}>
      <SectionHeading>При входе в карточку</SectionHeading>
      {Array.from({ length: Math.ceil(CLIENT_START_SECTIONS.length / 2) }, (_, row) => <View key={row} style={styles.choices}>
        {CLIENT_START_SECTIONS.slice(row * 2, row * 2 + 2).map((option) => <SelectionChip compact fill key={option.id}
          group="Начальный раздел карточки" label={option.label} selected={clientCards.startSection === option.id}
          onPress={() => setClientCards({ startSection: option.id })} />)}
      </View>)}
      </View>
      <View style={block}>
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
        <AppSwitch accessibilityLabel="Показывать ограничения здоровья" value={clientCards.showHealthBadge}
          onValueChange={(showHealthBadge) => setClientCards({ showHealthBadge })} />
      </View>
      </View>
      <View style={block}>
      <SectionHeading>Панель навигации</SectionHeading>
      <View style={styles.toggleRow}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>К списку клиентов</Text>
        <AppSwitch accessibilityLabel="Показывать кнопку К списку клиентов" value={navigationAppearance.showClientListShortcut}
          onValueChange={(enabled) => setNavigationAppearance("showClientListShortcut", enabled)} />
      </View>
      <View style={styles.toggleRow}>
        <Text style={[styles.toggleLabel, { color: colors.textPrimary }]}>Подписи кнопок навигации</Text>
        <AppSwitch accessibilityLabel="Показывать подписи кнопок навигации" value={!navigationAppearance.hideNavigationLabels}
          onValueChange={(enabled) => setNavigationAppearance("hideNavigationLabels", !enabled)} />
      </View>
      </View>
      <View style={block}>
      <SectionHeading>Дни рождения</SectionHeading>
      {saved === null && error === null ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>Загружаем настройки…</Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>{error}</Text> : null}
      {saved === null ? <AppButton variant="secondary" label="Повторить" onPress={() => { void load(); }} /> : null}
      {saved !== null ? <>
        <Text style={[styles.label, { color: colors.textPrimary }]}>Закреплять перед днём рождения</Text>
        <View style={styles.choices}>
          <SelectionChip fill group="Закрепление дня рождения" label="Включено" selected={saved.birthdayPinEnabled}
            onPress={() => commit({ birthdayPinEnabled: true })} />
          <SelectionChip fill group="Закрепление дня рождения" label="Выключено" selected={!saved.birthdayPinEnabled}
            onPress={() => commit({ birthdayPinEnabled: false })} />
        </View>
        <NumericField label="Закреплять за" unit="дней до дня рождения"
          decimalPolicy="integer" rawValue={leadDays} onChangeRawValue={(text) => { setLeadDays(text); setLeadInvalid(false); }}
          onBlur={commitLead} onSubmitEditing={commitLead} returnKeyType="done"
          hint="От 1 до 60 дней; значение сохранится и при выключенном закреплении."
          error={leadInvalid ? "Введите целое число от 1 до 60." : undefined} />
        <Text style={[styles.label, { color: colors.textPrimary }]}>Показывать короткий значок «ДР»</Text>
        <View style={styles.choices}>
          <SelectionChip fill group="Значок дня рождения" label="Включено" selected={saved.showBirthdayBadge}
            onPress={() => commit({ showBirthdayBadge: true })} />
          <SelectionChip fill group="Значок дня рождения" label="Выключено" selected={!saved.showBirthdayBadge}
            onPress={() => commit({ showBirthdayBadge: false })} />
        </View>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          Значок появляется за 7 дней до даты и не зависит от закрепления.
        </Text>
      </> : null}
      </View>
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  block: { borderRadius: 26, padding: 14, gap: 8, marginBottom: 4 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  toggleLabel: { flex: 1, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  choices: { flexDirection: "row", gap: 8 },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  message: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
