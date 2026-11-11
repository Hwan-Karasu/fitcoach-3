import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Heart } from "lucide-react-native";
import { AppButton, BottomSheet, InlineNotice } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { HealthAvailability } from "../domain/HealthModel.ts";
import type { HealthConnectPort, HealthStorePort } from "../domain/HealthPorts.ts";
import { syncedText } from "../domain/HealthSyncText.ts";
import type { HealthSyncResult } from "./HealthConnectSection.tsx";
import { useHealthLink } from "./useHealth.ts";

/** «Не сейчас» действует до следующего запуска приложения (общий для всех карточек: баннер один и тот же). */
let dismissedThisLaunch = false;

const UNAVAILABLE_TEXT: Readonly<Record<Exclude<HealthAvailability, "AVAILABLE">, string>> = {
  NOT_INSTALLED: "Health Connect не установлен. Установите приложение «Health Connect» из Google Play и вернитесь сюда.",
  UPDATE_REQUIRED: "Health Connect нужно обновить в Google Play.",
  UNSUPPORTED: "Это устройство не поддерживает Health Connect.",
};

/**
 * Предложение подключить Health Connect на главной (макет OnlyFits, UIX-FIT-10, M7): показывается, пока Health Connect не привязан ни к одной
 * карточке (привязка одна, «для себя»), на устройствах, где он вообще возможен; после привязки исчезает у всех. «Не сейчас» скрывает до
 * следующего запуска. «Подключить» открывает тот же лист подтверждения, что и раздел карточки, и ведёт тем же путём: привязка → доступ → обновление.
 */
export function HealthConnectBanner({ clientId, store, platform, sync }: Readonly<{ clientId: string; store: HealthStorePort; platform: HealthConnectPort;
  sync: () => Promise<HealthSyncResult> }>) {
  const colors = usePrototypeTheme().palette.tokens;
  const { link, loaded } = useHealthLink(store);
  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const [hidden, setHidden] = useState(dismissedThisLaunch);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { void platform.availability().then(setAvailability, () => setAvailability("UNSUPPORTED")); }, [platform]);

  const connect = async () => {
    if (busy) return;
    setBusy(true); setMessage(null); setConfirmOpen(false);
    try {
      const state = await platform.availability();
      if (state !== "AVAILABLE") { setMessage(UNAVAILABLE_TEXT[state]); return; }
      await store.link(clientId);
      await platform.requestPermissions();
      const result = await sync();
      setMessage(result.kind === "SYNCED" ? syncedText(result) : result.kind === "NO_PERMISSION" ? "Нет доступа к данным: разрешите чтение в окне Health Connect." : null);
    } catch (failure) {
      const code = failure instanceof Error ? failure.message.replace(/\s+/gu, " ").trim().slice(0, 120) : "";
      setMessage(`Не удалось подключить Health Connect.${code === "" ? "" : ` Код: ${code}`}`);
    } finally { setBusy(false); }
  };

  // Нет данных о привязке или устройство не поддерживает Health Connect — предложение не показываем.
  if (!loaded || availability === null || availability === "UNSUPPORTED") return null;
  const offer = link === null && !hidden;
  if (!offer && message === null) return null;
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceRaised }]}>
      {offer ? <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}><Heart size={22} color={colors.onAccentSoft} strokeWidth={2} /></View>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Health Connect не подключён</Text>
          <Text style={[styles.text, { color: colors.textSecondary }]}>Шаги, сон и расход калорий будут записываться сами. Данные читаются с этого телефона.</Text>
          <View style={styles.buttons}>
            <View style={styles.connect}><AppButton compact size="small" label="Подключить" busy={busy} onPress={() => setConfirmOpen(true)} /></View>
            <View><AppButton compact size="small" variant="ghost" label="Не сейчас" disabled={busy} onPress={() => { dismissedThisLaunch = true; setHidden(true); }} /></View>
          </View>
        </View>
      </View> : null}
      {message !== null ? <InlineNotice kind="info">{message}</InlineNotice> : null}
      <BottomSheet visible={confirmOpen} title="Подключить Health Connect?" onClose={() => setConfirmOpen(false)}
        footer={<View style={styles.footer}><AppButton label="Подключить" onPress={() => { void connect(); }} /><AppButton variant="ghost" label="Отмена" onPress={() => setConfirmOpen(false)} /></View>}>
        <Text style={[styles.text, { color: colors.textSecondary }]}>Система попросит доступ на чтение: шаги, сон, общий и активный расход, вес и % жира, а также историю данных. Доступ только для чтения, только для этой карточки («для себя»). В фоне приложение ничего не читает. Отключить можно в карточке клиента.</Text>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 12, gap: 8 },
  row: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  icon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 19 },
  text: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  buttons: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  connect: { minWidth: 120 },
  footer: { gap: 8 },
});
