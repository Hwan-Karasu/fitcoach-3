import { useCallback, useEffect, useSyncExternalStore } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { ManualBackupErrorCode, ManualBackupPort, RestoreActionsPort, AutomaticBackupPort } from "../../features/backup/public.ts";
import { AutomaticBackupSection } from "./AutomaticBackupSection.tsx";
import { RestoreSection } from "./RestoreSection.tsx";
import { BackupErrorCode, BackupProgressView, BackupTimingText } from "./BackupStatus.tsx";
import { AppButton, InlineNotice } from "../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

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

/** Privileged application-settings route. All SQLite/files/Android work stays behind the port. */
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
  const body = [styles.body, { color: palette.tokens.textSecondary }];
  const busy = state.phase !== "IDLE";
  const backupBlocked = busy || restoring.phase !== "IDLE" || autoState.phase !== "IDLE";
  // Ручная копия во время автокопии не запрещена: она встаёт в общую очередь и ждёт (BKP-LOCK-1).
  const createBlocked = busy || restoring.phase !== "IDLE";
  const working = state.phase === "CREATING" || state.phase === "PUBLISHING";
  useEffect(() => { void backup.refresh(); }, [backup]);
  return <PrototypeScreen description="Копия включает данные приложения и фото рецептов.">
    {!state.available ? <InlineNotice>{errors.BACKUP_STORAGE_UNAVAILABLE}</InlineNotice> : null}
    {state.error !== null ? <InlineNotice kind="error">{errors[state.error]}</InlineNotice> : null}
    {state.error !== null && state.errorStage !== null ? <BackupErrorCode code={state.error} stage={state.errorStage} /> : null}
    {state.error !== null && !busy && retryable(state.error) ? <AppButton label="Повторить копию" variant="secondary"
      disabled={createBlocked} onPress={() => { void backup.retry(); }} /> : null}
    {working ? <BackupProgressView progress={state.progress} fallback="Подготавливаем копию" />
      : busy ? <InlineNotice>{phases[state.phase]}</InlineNotice> : null}
    <SectionHeading>Папка для копий</SectionHeading>
    <Text style={body}>{state.location === "DOWNLOADS" ? "Загрузки / Дневник атлета" : state.location === "DIRECTORY" ? "Выбранная папка" : "Папка ещё не проверена"}</Text>
    <AppButton label="Выбрать папку" variant="secondary" disabled={!state.available || backupBlocked} onPress={() => { void backup.chooseFolder().then((outcome) => { if (outcome.kind === "UPDATED") void automatic.retry(); }); }} />
    {state.location !== "DOWNLOADS" ? <AppButton label="Использовать папку по умолчанию" variant="ghost"
      disabled={!state.available || backupBlocked} onPress={() => { void backup.useDefaultFolder().then((outcome) => { if (outcome.kind === "UPDATED") void automatic.retry(); }); }} /> : null}
    <AutomaticBackupSection backup={automatic} blocked={busy || restoring.phase !== "IDLE"} />
    <SectionHeading>Ручная копия</SectionHeading>
    <AppButton label="Создать копию сейчас" disabled={!state.available || createBlocked || state.location === "UNKNOWN"}
      onPress={() => { void backup.createNow(); }} />
    <AppButton label="Экспортировать в другое место" variant="secondary" disabled={!state.available || createBlocked}
      onPress={() => { void backup.exportElsewhere(); }} />
    <Text style={body}>Экспорт сохраняет отдельную копию и не меняет папку для следующих копий.</Text>
    {state.lastSaved !== null ? <View style={styles.saved}>
      <InlineNotice kind={state.error === null && !busy ? "success" : "info"}>{state.error === null && !busy ? "Копия сохранена и проверена." : "Ранее сохранённая копия доступна."}</InlineNotice>
      <Text selectable style={body}>{state.lastSaved.filename}</Text>
      <Text style={body}>{new Date(state.lastSaved.createdAt).toLocaleString("ru-RU")} · {Math.ceil(state.lastSaved.bytes / 1024)} КБ</Text>
      {state.lastRun !== null && !busy ? <BackupTimingText timing={state.lastRun} prefix="Создана" /> : null}
    </View> : null}
    <InlineNotice kind="warning">Копия содержит данные клиентов и не защищена паролем. Храните файл в надёжном месте.</InlineNotice>
    <RestoreSection restore={restore} blocked={busy || autoState.phase !== "IDLE"} />
  </PrototypeScreen>;
}
const styles = StyleSheet.create({ body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 }, saved: { gap: 8 } });
