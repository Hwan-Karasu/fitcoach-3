import { useCallback, useEffect, useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Folder } from "lucide-react-native";
import type { ManualBackupErrorCode, ManualBackupPort, RestoreActionsPort, AutomaticBackupPort } from "../../features/backup/public.ts";
import { AutomaticBackupRow, AutomaticBackupStatus } from "./AutomaticBackupSection.tsx";
import { RestoreSection } from "./RestoreSection.tsx";
import { BackupErrorCode, BackupProgressView, BackupTimingText } from "./BackupStatus.tsx";
import { backupMoment, backupSize } from "./backupFormat.ts";
import { AppButton, InlineNotice, SettingsGroup, SettingsRow } from "../../shared/ui/components/public.ts";
import { PrototypeScreen } from "../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { shadow } from "../../shared/ui/theme/style.ts";

const errors: Record<ManualBackupErrorCode, string> = {
  BACKUP_BUSY: "Дождитесь завершения текущей операции.",
  BACKUP_NOT_READY: "Дождитесь завершения текущей операции и повторите попытку.",
  BACKUP_STORAGE_UNAVAILABLE: "Создание копий недоступно в этой сборке приложения.",
  BACKUP_LOCATION_UNSUPPORTED: "Для сохранения копии выберите другую папку.",
  BACKUP_PUBLICATION_INVALID: "Не удалось подтвердить готовность копии. Повторите сохранение.",
  BACKUP_DESTINATION_UNAVAILABLE: "Не удалось сохранить копию. Проверьте доступ к папке и свободное место или выберите другую папку.",
  BACKUP_VERIFICATION_FAILED: "Копия не прошла проверку. Повторите сохранение или выберите другую папку.",
  BACKUP_SOURCE_UNAVAILABLE: "Не удалось подготовить копию по неизвестной причине. Ваши данные сохранены. Повторите попытку; если ошибка повторится, сообщите код ниже.",
  BACKUP_MEDIA_UNAVAILABLE: "Не удалось включить фото рецептов в копию: файл фото недоступен или изменился. Ваши данные сохранены. Повторите попытку.",
  BACKUP_SPACE_LOW: "Недостаточно свободного места для копии. Освободите место на телефоне и повторите попытку. Ваши данные сохранены.",
  BACKUP_SNAPSHOT_FAILED: "Не удалось снять копию базы. Ваши данные сохранены. Повторите попытку.",
  BACKUP_ARCHIVE_INVALID: "Подготовленная копия не прошла проверку целостности и не сохранена. Повторите попытку.",
  BACKUP_WRITE_FAILED: "Не удалось записать временный файл копии. Ваши данные сохранены. Повторите попытку.",
  BACKUP_FOLDER_UNAVAILABLE: "Папка для копий недоступна. Выберите её заново или вернитесь к папке по умолчанию.",
};
const phases = { IDLE: "", LOADING: "Проверяем папку…", CHOOSING: "Выберите папку в системном окне.",
  WAITING: "Ждём завершения автоматической копии…" } as const;
/** Повторять имеет смысл только сбой самой копии, а не занятость или неподдерживаемую папку. */
const retryable = (code: ManualBackupErrorCode) => !["BACKUP_BUSY", "BACKUP_STORAGE_UNAVAILABLE", "BACKUP_LOCATION_UNSUPPORTED", "BACKUP_FOLDER_UNAVAILABLE"].includes(code);

/**
 * Privileged application-settings route. All SQLite/files/Android work stays behind the port.
 * Вид — макет OnlyFits (UI-OWN-087): карточка «Последняя копия», две кнопки в ряд, два блока строк (папка и автокопии; восстановление и точка возврата).
 */
export function BackupScreen({ backup, restore, automatic }: Readonly<{ backup: ManualBackupPort; restore: RestoreActionsPort; automatic: AutomaticBackupPort }>) {
  const subscribe = useCallback((listener: () => void) => backup.subscribe(listener), [backup]);
  const getSnapshot = useCallback(() => backup.state, [backup]);
  const state = useSyncExternalStore(subscribe, getSnapshot);
  const restoreSubscribe = useCallback((listener: () => void) => restore.subscribe(listener), [restore]);
  const restoreSnapshot = useCallback(() => restore.state, [restore]);
  const restoring = useSyncExternalStore(restoreSubscribe, restoreSnapshot);
  const autoSubscribe = useCallback((listener: () => void) => automatic.subscribe(listener), [automatic]);
  const autoSnapshot = useCallback(() => automatic.state, [automatic]);
  const autoState = useSyncExternalStore(autoSubscribe, autoSnapshot);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const busy = state.phase !== "IDLE";
  const backupBlocked = busy || restoring.phase !== "IDLE" || autoState.phase !== "IDLE";
  // Ручная копия во время автокопии не запрещена: она встаёт в общую очередь и ждёт (BKP-LOCK-1).
  const createBlocked = busy || restoring.phase !== "IDLE";
  const working = state.phase === "CREATING" || state.phase === "PUBLISHING";
  const settled = state.error === null && !busy;
  useEffect(() => { void backup.refresh(); }, [backup]);
  const folder = state.location === "DOWNLOADS" ? "Загрузки / Дневник атлета" : state.location === "DIRECTORY" ? "Выбранная папка" : "Папка ещё не проверена";
  return <PrototypeScreen mockup>
    {!state.available ? <InlineNotice>{errors.BACKUP_STORAGE_UNAVAILABLE}</InlineNotice> : null}
    {state.error !== null ? <InlineNotice kind="error">{errors[state.error]}</InlineNotice> : null}
    {state.error !== null && state.errorStage !== null ? <BackupErrorCode code={state.error} stage={state.errorStage} /> : null}
    {state.error !== null && !busy && retryable(state.error) ? <AppButton label="Повторить копию" variant="secondary"
      disabled={createBlocked} onPress={() => { void backup.retry(); }} /> : null}
    {working ? <BackupProgressView progress={state.progress} fallback="Подготавливаем копию" />
      : busy ? <InlineNotice>{phases[state.phase]}</InlineNotice> : null}

    <View style={[styles.last, shadow.card, { backgroundColor: colors.surface }]}>
      <Text style={[styles.lastLabel, { color: colors.textMuted }]}>ПОСЛЕДНЯЯ КОПИЯ</Text>
      {state.lastSaved !== null ? <>
        <Text style={[styles.lastTitle, { color: colors.textPrimary }]}>{backupMoment(state.lastSaved.createdAt)}</Text>
        <Text style={[styles.lastCaption, { color: colors.textSecondary }]}>{backupSize(state.lastSaved.bytes)} · {settled ? "проверена" : "сохранена ранее"}</Text>
        <Text selectable numberOfLines={1} style={[styles.lastFile, { color: colors.textMuted }]}>{state.lastSaved.filename}</Text>
        {state.lastRun !== null && !busy ? <BackupTimingText timing={state.lastRun} prefix="Создана" /> : null}
      </> : <>
        <Text style={[styles.lastTitle, { color: colors.textPrimary }]}>Копии ещё нет</Text>
        <Text style={[styles.lastCaption, { color: colors.textSecondary }]}>Нажмите «Создать копию»</Text>
      </>}
    </View>

    <View style={styles.buttons}>
      <View style={styles.button}><AppButton label="Создать копию" disabled={!state.available || createBlocked || state.location === "UNKNOWN"}
        onPress={() => { void backup.createNow(); }} /></View>
      <View style={styles.button}><AppButton label="Экспортировать" variant="secondary" disabled={!state.available || createBlocked}
        onPress={() => { void backup.exportElsewhere(); }} /></View>
    </View>
    <Text style={[styles.hint, { color: colors.textSecondary }]}>Экспорт сохраняет отдельную копию и не меняет папку для следующих копий.</Text>

    <SettingsGroup>
      <SettingsRow icon={Folder} title="Папка для копий" caption={folder} disabled={!state.available || backupBlocked}
        onPress={() => { void backup.chooseFolder().then((outcome) => { if (outcome.kind === "UPDATED") void automatic.retry(); }); }} />
      <AutomaticBackupRow backup={automatic} last />
    </SettingsGroup>
    {state.location !== "DOWNLOADS" ? <AppButton label="Использовать папку по умолчанию" variant="ghost"
      disabled={!state.available || backupBlocked} onPress={() => { void backup.useDefaultFolder().then((outcome) => { if (outcome.kind === "UPDATED") void automatic.retry(); }); }} /> : null}
    <AutomaticBackupStatus backup={automatic} blocked={busy || restoring.phase !== "IDLE"} />

    <RestoreSection restore={restore} blocked={busy || autoState.phase !== "IDLE"} />
    <Text style={[styles.hint, styles.center, { color: colors.textSecondary }]}>Копия включает данные приложения и фото рецептов. Она содержит данные клиентов и не защищена паролем — храните файл в надёжном месте.</Text>
  </PrototypeScreen>;
}
const styles = StyleSheet.create({
  last: { borderRadius: 28, padding: 16, gap: 4 },
  lastLabel: { fontFamily: fonts.bold, fontSize: 11, lineHeight: 15, letterSpacing: 0.7 },
  lastTitle: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 28 },
  lastCaption: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
  lastFile: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  buttons: { flexDirection: "row", gap: 8, marginTop: 4 },
  button: { flex: 1, minWidth: 0 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 6 },
  center: { textAlign: "center" },
});
