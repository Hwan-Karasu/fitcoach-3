import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { RestoreActionErrorCode, RestoreActionsPort, RestorePreview } from "../../features/backup/public.ts";
import { ArchiveRestore, History } from "lucide-react-native";
import { AppButton, InlineNotice, SettingsGroup, SettingsRow } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { shadow } from "../../shared/ui/theme/style.ts";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { BackupErrorCode, RestoreApplyView, RestorePreparationView } from "./BackupStatus.tsx";

const errors: Record<RestoreActionErrorCode, string> = {
  RESTORE_UNAVAILABLE: "Восстановление недоступно в этой сборке приложения.",
  RESTORE_NOT_READY: "Дождитесь завершения текущей операции и повторите попытку.",
  RESTORE_BUSY: "Дождитесь завершения текущей операции.",
  RESTORE_INVALID_BACKUP: "Этот файл не удалось распознать как совместимую и целую копию. Выберите другую копию.",
  RESTORE_SOURCE_UNAVAILABLE: "Не удалось прочитать или подготовить копию. Проверьте доступ к файлу и повторите попытку.",
  RESTORE_STALE_PREVIEW: "После подготовки данные изменились. Выберите копию ещё раз, чтобы проверить актуальное состояние.",
  RESTORE_NO_SPACE: "Для безопасного восстановления недостаточно свободного места. Освободите место на телефоне и повторите попытку.",
  RESTORE_FAILED: "Восстановление не выполнено. Прежние данные сохранены. Повторите попытку или выберите другую копию.",
  RESTORE_POINT_UNAVAILABLE: "Точка возврата недоступна или не прошла проверку. Вы можете восстановить данные из сохранённого файла копии.",
  RESTORE_RECOVERY_REQUIRED: "Завершение восстановления требует повторной попытки. Исходные файлы сохранены.",
  RESTORE_NEWER_BACKUP: "Эта копия создана более новой версией приложения. Обновите приложение и повторите восстановление — текущие данные не изменены.",
};
const date = (value: string) => new Date(value).toLocaleString("ru-RU");

/** Preview is read-only. Only the destructive action in the confirmation dialog passes its ID. */
export function RestoreSection({ restore, blocked }: Readonly<{ restore: RestoreActionsPort; blocked: boolean }>) {
  const subscribe = useCallback((listener: () => void) => restore.subscribe(listener), [restore]);
  const snapshot = useCallback(() => restore.state, [restore]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const { palette } = usePrototypeTheme();
  const body = [styles.body, { color: palette.tokens.textSecondary }];
  const busy = blocked || !["IDLE", "PREVIEW"].includes(state.phase);
  // Уход с экрана НЕ отменяет подготовку и не сбрасывает предпросмотр (BKP-AUDIT-1 D2): операция принадлежит сервису, а не экрану.
  // Отмена — только кнопками «Отменить подготовку» / «Отменить выбор».
  useEffect(() => { void restore.refresh(); }, [restore]);
  const confirm = (preview: RestorePreview) => {
    const returning = preview.kind === "RETURN";
    Alert.alert(returning ? "Вернуть прежние данные?" : "Заменить текущие данные?",
      returning ? "Все текущие данные будут заменены состоянием перед последним восстановлением. Последующие изменения будут потеряны. Точка возврата будет использована один раз."
        : "Все текущие данные будут заменены данными выбранной копии. Перед заменой приложение сохранит точку возврата с нынешними данными.",
      [{ text: "Отмена", style: "cancel" }, { text: returning ? "Вернуть данные" : "Восстановить", style: "destructive", onPress: () => {
        void restore.confirmPreview(preview.id).then((outcome) => {
          if (outcome.kind === "RESTORED" || outcome.kind === "RETURNED") Alert.alert(outcome.kind === "RESTORED" ? "Данные восстановлены" : "Прежние данные возвращены",
            outcome.kind === "RESTORED" ? "Приложение открыло данные выбранной копии. Точка возврата доступна в настройках резервных копий." : "Точка возврата использована.");
        });
      } }]);
  };
  const point = state.point;
  const colors = palette.tokens;
  return <>
    {!state.available ? <InlineNotice>{errors.RESTORE_UNAVAILABLE}</InlineNotice> : null}
    {state.error !== null ? <InlineNotice kind="error">{errors[state.error]}</InlineNotice> : null}
    {state.error !== null && state.errorStage ? <BackupErrorCode code={state.error} stage={state.errorStage} /> : null}
    {state.phase === "PREPARING" ? state.cancelRequested === true ? <InlineNotice>Отменяем подготовку…</InlineNotice>
      : <><RestorePreparationView progress={state.preparation ?? null} />
        <AppButton label="Отменить подготовку" variant="ghost" onPress={() => { void restore.cancelPreview(); }} /></> : null}
    {state.phase === "APPLYING" ? <RestoreApplyView phase={state.applying ?? null} /> : null}
    {state.notice !== null ? <InlineNotice kind="success">{state.notice === "RESTORED" ? "Данные восстановлены из выбранной копии."
      : state.notice === "RETURNED" ? "Прежние данные возвращены. Точка возврата использована." : state.notice === "CHECKED" ? "Проверка завершена. Данные доступны." : "Точка возврата удалена."}</InlineNotice> : null}
    {state.phase === "RECOVERY_REQUIRED" ? <AppButton label="Повторить восстановление" disabled={blocked} onPress={() => { void restore.recover(); }} /> : null}
    <SettingsGroup>
      <SettingsRow icon={ArchiveRestore} title="Выбрать файл копии" caption="Восстановление данных" disabled={!state.available || busy || state.preview !== null}
        onPress={() => { void restore.chooseFile(); }} />
      <SettingsRow icon={History} title="Точка возврата" caption={point === null ? "Пока нет" : `Прежнее состояние от ${date(point.createdAt)}`} captionMuted={point === null} last
        disabled={busy || state.preview !== null} onPress={point === null ? undefined : () => { void restore.previewReturn(); }} />
    </SettingsGroup>
    {state.preview !== null ? <View style={[styles.preview, shadow.card, { backgroundColor: colors.surface }]}>
      <Text style={[styles.previewTitle, { color: colors.textPrimary }]}>{state.preview.kind === "RETURN" ? "Точка возврата" : "Выбранная копия"} · {date(state.preview.createdAt)}</Text>
      <Text style={body}>Клиенты: {state.preview.activeClients} · В архиве: {state.preview.archivedClients}</Text>
      <AppButton label={state.preview.kind === "RETURN" ? "Вернуть прежние данные" : "Восстановить из этой копии"} disabled={busy} onPress={() => { if (state.preview !== null) confirm(state.preview); }} />
      <AppButton label="Отменить выбор" variant="ghost" disabled={busy} onPress={() => { void restore.cancelPreview(); }} />
    </View> : null}
    {point !== null && state.preview === null ? <AppButton label="Удалить точку возврата" variant="ghost" disabled={busy} onPress={() => {
      Alert.alert("Удалить точку возврата?", "Вернуть состояние перед последним восстановлением через эту точку больше не получится. Сохранённые файлы копий останутся.",
        [{ text: "Отмена", style: "cancel" }, { text: "Удалить", style: "destructive", onPress: () => { void restore.deletePoint(point.id); } }]);
    }} /> : null}
    <Text style={body}>Восстановление полностью заменяет текущие данные состоянием из копии. Точка возврата хранится внутри приложения и удаляется вместе с ним — для переустановки сохраняйте отдельные файлы копий.</Text>
  </>;
}
const styles = StyleSheet.create({
  body: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, paddingHorizontal: 6 },
  preview: { borderRadius: 26, padding: 16, gap: 10 },
  previewTitle: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 20 },
});
