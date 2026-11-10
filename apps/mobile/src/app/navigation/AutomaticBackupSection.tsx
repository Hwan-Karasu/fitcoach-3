import { useCallback, useSyncExternalStore } from "react";
import { Pressable, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AutomaticBackupErrorCode, AutomaticBackupPort } from "../../features/backup/public.ts";
import { Clock } from "lucide-react-native";
import { AppButton, InlineNotice, SettingsRow } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { BackupErrorCode, BackupProgressView, BackupTimingText } from "./BackupStatus.tsx";

/** Текст — по установленной причине (BKP-DIAG-1); «свободное место» — только когда о нём сообщили проверка или SQLite/ОС. */
const errors: Record<AutomaticBackupErrorCode, string> = {
  AUTO_UNAVAILABLE: "Автоматические копии недоступны в этой сборке приложения.",
  AUTO_NOT_READY: "Проверка копий продолжится после завершения текущей операции.",
  AUTO_FOLDER_UNAVAILABLE: "Автоматические копии приостановлены: папка недоступна. Повторите проверку или выберите другую папку.",
  AUTO_SOURCE_UNAVAILABLE: "Не удалось подготовить автоматическую копию по неизвестной причине. Рабочие данные сохранены. Повторите проверку; если ошибка повторится, сообщите код ниже.",
  AUTO_SPACE_LOW: "Недостаточно свободного места для автоматической копии. Освободите место на телефоне и повторите проверку. Рабочие данные сохранены.",
  AUTO_MEDIA_UNAVAILABLE: "Не удалось включить в копию фото рецепта: файл фото недоступен или изменился. Рабочие данные сохранены. Проверьте фото рецептов и повторите проверку.",
  AUTO_SNAPSHOT_FAILED: "Не удалось снять копию базы. Рабочие данные сохранены. Повторите проверку.",
  AUTO_ARCHIVE_INVALID: "Подготовленная копия не прошла проверку целостности и не сохранена. Прежние копии сохранены. Повторите проверку.",
  AUTO_WRITE_FAILED: "Не удалось записать временный файл копии. Рабочие данные сохранены. Повторите проверку.",
  AUTO_VERIFICATION_FAILED: "Копия не прошла проверку. Прежние файлы сохранены. Повторите проверку или выберите другую папку.",
  AUTO_STATE_UNAVAILABLE: "Не удалось проверить список автоматических копий. Прежние файлы сохранены. Повторите проверку.",
  AUTO_CLOCK_CHANGED: "Автоматические копии приостановлены после изменения даты или часового пояса. Проверьте настройки времени телефона.",
  AUTO_CLEANUP_PENDING: "Новая копия сохранена, но очистка прежних версий не завершена. Повторите проверку.",
};
function useAutomaticState(backup: AutomaticBackupPort) {
  const subscribe = useCallback((listener: () => void) => backup.subscribe(listener), [backup]);
  const snapshot = useCallback(() => backup.state, [backup]);
  return useSyncExternalStore(subscribe, snapshot);
}

/** Строка «Автоматические копии» в блоке настроек копий: проверка раз в 30 минут и число сохранённых версий (макет «Версий 3 из 3»). */
export function AutomaticBackupRow({ backup, last = false }: Readonly<{ backup: AutomaticBackupPort; last?: boolean }>) {
  const state = useAutomaticState(backup);
  const caption = !state.available ? "Недоступны в этой сборке" : state.lastSaved === null ? "Проверка каждые 30 минут · пока не создана"
    : `Проверка каждые 30 минут · версий ${state.versions} из 3`;
  return <SettingsRow icon={Clock} title="Автоматические копии" caption={caption} last={last} />;
}

/** Сообщения об автокопиях вне блока строк: недоступность, прогресс, ошибка с кодом и «Повторить»; в покое ничего не занимает места. */
export function AutomaticBackupStatus({ backup, blocked }: Readonly<{ backup: AutomaticBackupPort; blocked: boolean }>) {
  const state = useAutomaticState(backup);
  const { palette } = usePrototypeTheme();
  const body = { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 6, color: palette.tokens.textSecondary };
  return <>
    {!state.available ? <InlineNotice>{errors.AUTO_UNAVAILABLE}</InlineNotice> : null}
    {state.phase !== "IDLE" ? <BackupProgressView progress={state.progress} fallback="Проверяем автоматическую копию" /> : null}
    {state.error !== null ? <InlineNotice kind="error">{errors[state.error]}</InlineNotice> : null}
    {state.error !== null && state.error !== "AUTO_NOT_READY" ? <BackupErrorCode code={state.error} stage={state.errorStage} /> : null}
    {state.lastRun !== null && state.phase === "IDLE" ? <BackupTimingText timing={state.lastRun} prefix="Автоматическая копия создана" /> : null}
    {state.error !== null ? <AppButton label="Повторить проверку копий" variant="secondary" disabled={blocked || state.phase !== "IDLE"}
      onPress={() => { void backup.retry(); }} /> : null}
    <Text style={body}>Ручные экспорты и точка возврата хранятся отдельно от трёх автоматических версий.</Text>
  </>;
}

/** A meaningful failure remains noticeable outside settings; no recurring dialogs or codes. */
export function AutomaticBackupNotice({ backup, onOpen }: Readonly<{ backup: AutomaticBackupPort; onOpen: () => void }>) {
  const subscribe = useCallback((listener: () => void) => backup.subscribe(listener), [backup]);
  const snapshot = useCallback(() => backup.state, [backup]); const state = useSyncExternalStore(subscribe, snapshot);
  const { palette } = usePrototypeTheme();
  if (!state.available || state.error === null || state.error === "AUTO_NOT_READY") return null;
  return <SafeAreaView edges={["top"]} accessibilityRole="alert" style={{ borderWidth: 1, borderColor: palette.tokens.warning,
    backgroundColor: palette.tokens.surface, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Text style={{ flex: 1, fontFamily: fonts.regular, fontSize: 13, color: palette.tokens.textPrimary }}>Резервные копии требуют внимания.</Text>
    <Pressable accessibilityRole="button" onPress={onOpen} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
      <Text style={{ color: palette.tokens.textPrimary }}>Подробнее</Text>
    </Pressable>
  </SafeAreaView>;
}
