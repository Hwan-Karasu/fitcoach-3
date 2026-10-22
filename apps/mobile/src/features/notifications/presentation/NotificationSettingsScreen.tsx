import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, Switch, Text, View } from "react-native";
import { AppButton, ChoiceSegments, HourMinutePicker, InlineNotice, LoadingState, TimeWheelPicker } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { NotificationCenterPort } from "../domain/NotificationCenterPort.ts";
import { MAX_REMINDER_MINUTES, MIN_REMINDER_MINUTES, RETENTION_CHOICES, type NotificationSettings, type RetentionDays } from "../domain/NotificationSettings.ts";
import type { OsPermission, PlatformNotificationPort } from "../domain/PlatformNotificationPort.ts";
import { clockText, leadText } from "../domain/ReminderPlanner.ts";

type Picker = "appointment" | "duty" | "quietStart" | "quietEnd" | null;

const permissionText: Readonly<Record<OsPermission, string>> = {
  granted: "Системные уведомления разрешены.",
  undetermined: "Системное разрешение ещё не выдано: оно запросится при включении напоминания.",
  denied: "Системные уведомления запрещены. Напоминания не будут показаны, пока вы не разрешите их в настройках телефона.",
};

function Row({ title, detail, children }: Readonly<{ title: string; detail?: string; children: React.ReactNode }>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  return <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
    <View style={styles.rowText}>
      <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>{title}</Text>
      {detail !== undefined ? <Text style={[styles.rowDetail, { color: colors.textSecondary }]}>{detail}</Text> : null}
    </View>
    {children}
  </View>;
}

/**
 * Настройки уведомлений (§§41, 54.1): напоминания о записях и дежурствах, интервалы «за N до начала», тихие часы, срок хранения ленты
 * и статус системного разрешения. Значение показывается изменённым только после успешной записи; сбой записи выводится и ничего не подменяет.
 */
export function NotificationSettingsScreen({ center, platform, onChanged }: Readonly<{ center: NotificationCenterPort; platform: PlatformNotificationPort;
  /** После сохранения: перепланировать напоминания по новым настройкам. */
  onChanged: () => void }>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [permission, setPermission] = useState<OsPermission | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);

  const refreshPermission = useCallback(() => {
    platform.permission().then(setPermission, () => setPermission(null));
  }, [platform]);
  useEffect(() => {
    let active = true;
    center.getSettings().then((value) => { if (active) setSettings(value); }, () => { if (active) setFailed(true); });
    refreshPermission();
    // Вернулись из системных настроек телефона — статус мог измениться.
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refreshPermission(); });
    return () => { active = false; subscription.remove(); };
  }, [center, refreshPermission]);

  const save = async (next: NotificationSettings, askPermission = false) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      // Разрешение запрашивается в понятном контексте — когда тренер включает напоминание (§41.12); отказ настройку не сбрасывает.
      if (askPermission && (permission === "undetermined" || permission === null)) setPermission(await platform.requestPermission().catch(() => "denied" as const));
      setSettings(await center.saveSettings(next));
      onChanged();
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "NOTIFICATION_SETTINGS_INVALID"
        ? "Проверьте значения: начало и конец тихих часов не должны совпадать, интервал — от 1 минуты до 24 часов."
        : "Не удалось сохранить настройку. Значение не изменено.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };

  if (failed) return <PrototypeScreen><InlineNotice kind="error">Не удалось загрузить настройки уведомлений.</InlineNotice></PrototypeScreen>;
  if (settings === null) return <LoadingState label="Загружаем настройки…" />;
  const { appointment, duty, quietHours } = settings;
  const toggleColors = { false: colors.border, true: colors.accentFill };

  return (
    <PrototypeScreen>
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {permission !== null ? <InlineNotice kind={permission === "denied" ? "warning" : "info"}>{permissionText[permission]}</InlineNotice> : null}
      {permission === "denied" ? <AppButton variant="secondary" label="Открыть настройки телефона" onPress={() => { void platform.openSystemSettings(); }} /> : null}

      <SectionHeading>Записи</SectionHeading>
      <Row title="Напоминать о записях" detail="Одно напоминание на запись">
        <Switch accessibilityLabel="Напоминать о записях" value={appointment.enabled} disabled={busy} trackColor={toggleColors} thumbColor={colors.surface}
          onValueChange={(enabled) => { void save({ ...settings, appointment: { ...appointment, enabled } }, enabled); }} />
      </Row>
      {appointment.enabled ? <AppButton variant="secondary" label={`За ${leadText(appointment.minutesBefore)} до начала`} disabled={busy} onPress={() => setPicker("appointment")} /> : null}

      <SectionHeading>Дежурства</SectionHeading>
      <Row title="Напоминать о дежурствах" detail="Отдельно от записей">
        <Switch accessibilityLabel="Напоминать о дежурствах" value={duty.enabled} disabled={busy} trackColor={toggleColors} thumbColor={colors.surface}
          onValueChange={(enabled) => { void save({ ...settings, duty: { ...duty, enabled } }, enabled); }} />
      </Row>
      {duty.enabled ? <AppButton variant="secondary" label={`За ${leadText(duty.minutesBefore)} до начала`} disabled={busy} onPress={() => setPicker("duty")} /> : null}

      <SectionHeading>Тихие часы</SectionHeading>
      <Row title="Не беспокоить напоминаниями" detail="Попавшие в этот интервал напоминания не показываются и не переносятся. Таймер отдыха не отключается.">
        <Switch accessibilityLabel="Тихие часы" value={quietHours.enabled} disabled={busy} trackColor={toggleColors} thumbColor={colors.surface}
          onValueChange={(enabled) => { void save({ ...settings, quietHours: { ...quietHours, enabled } }); }} />
      </Row>
      {quietHours.enabled ? <View style={styles.pair}>
        <View style={styles.half}><AppButton variant="secondary" label={`С ${clockText(quietHours.startMinute)}`} disabled={busy} onPress={() => setPicker("quietStart")} /></View>
        <View style={styles.half}><AppButton variant="secondary" label={`До ${clockText(quietHours.endMinute)}`} disabled={busy} onPress={() => setPicker("quietEnd")} /></View>
      </View> : null}

      <SectionHeading>История центра</SectionHeading>
      <Text style={[styles.rowDetail, { color: colors.textSecondary }]}>Сколько дней хранятся уведомления в ленте. Записи, абонементы и тренировки не удаляются.</Text>
      <ChoiceSegments<`${RetentionDays}`> label="Срок хранения" value={`${settings.retentionDays}`} disabled={busy}
        items={RETENTION_CHOICES.map((days) => ({ id: `${days}` as `${RetentionDays}`, label: `${days} дн.` }))}
        onChange={(id) => { void save({ ...settings, retentionDays: Number(id) as RetentionDays }); }} />

      <HourMinutePicker visible={picker === "appointment"} title="Напоминать о записи за" value={appointment.minutesBefore}
        min={MIN_REMINDER_MINUTES} max={MAX_REMINDER_MINUTES} onClose={() => setPicker(null)}
        onConfirm={(minutesBefore) => { void save({ ...settings, appointment: { ...appointment, minutesBefore } }); }} />
      <HourMinutePicker visible={picker === "duty"} title="Напоминать о дежурстве за" value={duty.minutesBefore}
        min={MIN_REMINDER_MINUTES} max={MAX_REMINDER_MINUTES} onClose={() => setPicker(null)}
        onConfirm={(minutesBefore) => { void save({ ...settings, duty: { ...duty, minutesBefore } }); }} />
      <TimeWheelPicker visible={picker === "quietStart"} title="Тихие часы начинаются" value={quietHours.startMinute} min={0} max={1439} minuteStep={5}
        onClose={() => setPicker(null)} onConfirm={(startMinute) => { void save({ ...settings, quietHours: { ...quietHours, startMinute } }); }} />
      <TimeWheelPicker visible={picker === "quietEnd"} title="Тихие часы заканчиваются" value={quietHours.endMinute} min={0} max={1439} minuteStep={5}
        onClose={() => setPicker(null)} onConfirm={(endMinute) => { void save({ ...settings, quietHours: { ...quietHours, endMinute } }); }} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  row: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  rowDetail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  pair: { flexDirection: "row", gap: 8 },
  half: { flex: 1 },
});
