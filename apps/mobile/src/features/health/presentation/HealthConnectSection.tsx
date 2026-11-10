import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, BottomSheet, ConfirmDialog, InlineNotice } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { HEALTH_METRICS, HEALTH_METRIC_LABELS, type HealthAvailability, type HealthLink, type HealthMetric } from "../domain/HealthModel.ts";
import type { HealthConnectPort, HealthStorePort } from "../domain/HealthPorts.ts";
import { useHealthLink } from "./useHealth.ts";

/** Итог обновления, как его отдаёт workflow: экрану нужен только вид. */
export type HealthSyncKind = "SYNCED" | "NOT_LINKED" | "UNAVAILABLE" | "NO_PERMISSION";

const availabilityText: Readonly<Record<Exclude<HealthAvailability, "AVAILABLE">, string>> = {
  NOT_INSTALLED: "Health Connect не установлен. Установите приложение «Health Connect» из Google Play и вернитесь сюда.",
  UPDATE_REQUIRED: "Health Connect нужно обновить в Google Play.",
  UNSUPPORTED: "Это устройство не поддерживает Health Connect.",
};
const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."] as const;
const stampText = (iso: string): string => {
  const at = new Date(iso);
  return `${at.getDate()} ${MONTHS[at.getMonth()]}, ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
};

/**
 * Раздел «Health Connect» карточки (UIX-17, ADR-059): привязка к одной карточке «для себя», доступ по видам данных, «Обновить данные», «Открыть настройки Health Connect»,
 * «Отключить». Только чтение из системы; отключение снимает привязку и доступ, записанные данные остаются. Экран не пишет данные дня сам — это делает `sync`.
 */
export function HealthConnectSection({ clientId, store, platform, sync }: Readonly<{ clientId: string; store: HealthStorePort; platform: HealthConnectPort;
  sync: () => Promise<Readonly<{ kind: HealthSyncKind }>> }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const { link, loaded } = useHealthLink(store);
  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const [granted, setGranted] = useState<readonly HealthMetric[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const refreshState = useCallback(async () => {
    const state = await platform.availability();
    setAvailability(state);
    setGranted(state === "AVAILABLE" ? await platform.grantedMetrics() : []);
  }, [platform]);
  useEffect(() => { void refreshState().catch(() => undefined); }, [refreshState, link?.lastSyncAt]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage(null); setErrorText(null);
    try { await work(); } catch (failure) {
      setErrorText(failure instanceof Error && failure.message === "HEALTH_ALREADY_LINKED" ? "Health Connect уже подключён к другой карточке." : "Не удалось завершить действие. Проверьте подключение и повторите обновление.");
    } finally { setBusy(false); }
    await refreshState().catch(() => undefined);
  };
  const outcomeText = (kind: HealthSyncKind): string => kind === "SYNCED" ? "Данные обновлены."
    : kind === "NO_PERMISSION" ? "Нет доступа к данным: разрешите чтение в окне Health Connect."
      : kind === "UNAVAILABLE" ? "Health Connect недоступен на этом устройстве." : "Health Connect не подключён.";

  const connect = () => run(async () => {
    setConnectOpen(false);
    const state = await platform.availability();
    if (state !== "AVAILABLE") { setMessage(availabilityText[state]); return; }
    await store.link(clientId);
    await platform.requestPermissions();
    setMessage(outcomeText((await sync()).kind));
  });
  const refresh = () => run(async () => {
    if (granted.length < HEALTH_METRICS.length) await platform.requestPermissions();
    setMessage(outcomeText((await sync()).kind));
  });
  const disconnect = () => run(async () => {
    setDisconnectOpen(false);
    await store.unlink();
    // Системный доступ отзывается в настройках Health Connect (отзыв из приложения действует только после перезапуска).
    setMessage("Health Connect отключён. Записанные данные остались; доступ приложения можно отозвать в настройках Health Connect.");
  });

  const linked: HealthLink | null = link !== null && link.clientId === clientId ? link : null;
  const other = link !== null && link.clientId !== clientId;
  return (
    <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Health Connect</Text>
      {!loaded ? <Text style={[styles.text, { color: colors.textSecondary }]}>Проверяем подключение…</Text>
        : other ? <Text style={[styles.text, { color: colors.textSecondary }]}>Health Connect подключён к другой карточке. Отключите его там, чтобы подключить здесь.</Text>
          : linked === null ? <>
            <Text style={[styles.text, { color: colors.textSecondary }]}>Шаги, сон, расход, вес и % жира читаются из Health Connect только для этой карточки — «для себя». Приложение ничего не записывает в Health Connect.</Text>
            {availability !== null && availability !== "AVAILABLE" ? <InlineNotice kind="info">{availabilityText[availability]}</InlineNotice> : null}
            <AppButton label="Подключить Health Connect" busy={busy} onPress={() => setConnectOpen(true)} />
          </> : <>
            <Text style={[styles.text, { color: colors.textPrimary }]}>{`Подключено · ${linked.lastSyncAt === null ? "данные ещё не обновлялись" : `обновлено ${stampText(linked.lastSyncAt)}`}`}</Text>
            {availability !== null && availability !== "AVAILABLE" ? <InlineNotice kind="error">{availabilityText[availability]}</InlineNotice> : null}
            <View style={styles.rows}>
              {HEALTH_METRICS.map((metric) => (
                <View key={metric} accessible accessibilityLabel={`${HEALTH_METRIC_LABELS[metric]}: ${granted.includes(metric) ? "доступ есть" : "доступа нет"}`} style={styles.row}>
                  <Text style={[styles.text, { color: colors.textPrimary }]}>{HEALTH_METRIC_LABELS[metric]}</Text>
                  <Text style={[styles.text, { color: granted.includes(metric) ? colors.accentInk : colors.textMuted }]}>{granted.includes(metric) ? "доступ есть" : "нет доступа"}</Text>
                </View>
              ))}
            </View>
            <AppButton label={granted.length < HEALTH_METRICS.length ? "Дать доступ и обновить" : "Обновить данные"} busy={busy} onPress={() => { void refresh(); }} />
            <AppButton variant="secondary" label="Открыть настройки Health Connect" onPress={() => {
              void Promise.resolve().then(() => platform.openSettings()).catch(() => setErrorText("Не удалось открыть настройки Health Connect."));
            }} />
            <AppButton variant="destructive" label="Отключить" disabled={busy} onPress={() => setDisconnectOpen(true)} />
          </>}
      {message !== null ? <InlineNotice kind="info">{message}</InlineNotice> : null}
      {errorText !== null ? <InlineNotice kind="error">{errorText}</InlineNotice> : null}
      <BottomSheet visible={connectOpen} title="Подключить Health Connect?" onClose={() => setConnectOpen(false)}
        footer={<View style={styles.footer}><AppButton label="Подключить" onPress={() => { void connect(); }} /><AppButton variant="ghost" label="Отмена" onPress={() => setConnectOpen(false)} /></View>}>
        <Text style={[styles.text, { color: colors.textSecondary }]}>Система попросит доступ на чтение: шаги, сон, общий и активный расход, вес и % жира, а также историю данных. Доступ только для чтения, только для этой карточки. В фоне приложение ничего не читает. «Отключить» останавливает перенос в карточку; системные разрешения можно отозвать в настройках Health Connect.</Text>
      </BottomSheet>
      <ConfirmDialog visible={disconnectOpen} title="Отключить Health Connect?" description="Привязка будет снята, обновление данных прекратится. Уже записанные данные остаются в приложении; доступ можно отозвать в настройках Health Connect." confirmLabel="Отключить"
        destructive onCancel={() => setDisconnectOpen(false)} onConfirm={() => { void disconnect(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 26, padding: 16, gap: 10, marginTop: 12 },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  text: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  rows: { gap: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 28 },
  footer: { gap: 8 },
});
