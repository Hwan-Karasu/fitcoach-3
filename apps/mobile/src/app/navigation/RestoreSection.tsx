import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import type { RestoreActionErrorCode, RestoreActionsPort, RestorePreview } from "../../features/backup/public.ts";
import { AppButton, InlineNotice } from "../../shared/ui/components/public.ts";
import { SectionHeading } from "../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

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
  useEffect(() => { void restore.refresh(); return () => { void restore.cancelPreview(); }; }, [restore]);
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
  return <View style={styles.section}>
    <SectionHeading>Восстановление данных</SectionHeading>
    {!state.available ? <InlineNotice>{errors.RESTORE_UNAVAILABLE}</InlineNotice> : null}
    {state.error !== null ? <InlineNotice kind="error">{errors[state.error]}</InlineNotice> : null}
    {state.phase === "PREPARING" ? <InlineNotice>Проверяем и подготавливаем копию…</InlineNotice> : null}
    {state.notice !== null ? <InlineNotice kind="success">{state.notice === "RESTORED" ? "Данные восстановлены из выбранной копии."
      : state.notice === "RETURNED" ? "Прежние данные возвращены. Точка возврата использована." : state.notice === "CHECKED" ? "Проверка завершена. Данные доступны." : "Точка возврата удалена."}</InlineNotice> : null}
    {state.phase === "RECOVERY_REQUIRED" ? <AppButton label="Повторить восстановление" disabled={blocked} onPress={() => { void restore.recover(); }} /> : null}
    <Text style={body}>Восстановление полностью заменяет текущие данные состоянием из копии.</Text>
    <AppButton label="Выбрать файл копии" variant="secondary" disabled={!state.available || busy || state.preview !== null} onPress={() => { void restore.chooseFile(); }} />
    {state.preview !== null ? <View style={styles.section}>
      <Text style={body}>{state.preview.kind === "RETURN" ? "Точка возврата" : "Выбранная копия"} · {date(state.preview.createdAt)}</Text>
      <Text style={body}>Клиенты: {state.preview.activeClients} · В архиве: {state.preview.archivedClients}</Text>
      <AppButton label={state.preview.kind === "RETURN" ? "Вернуть прежние данные" : "Восстановить из этой копии"} disabled={busy} onPress={() => { if (state.preview !== null) confirm(state.preview); }} />
      <AppButton label="Отменить выбор" variant="ghost" disabled={busy} onPress={() => { void restore.cancelPreview(); }} />
    </View> : null}
    <SectionHeading>Точка возврата</SectionHeading>
    <Text style={body}>{point === null ? "После успешного восстановления здесь будет доступно прежнее состояние данных."
      : `Прежнее состояние от ${date(point.createdAt)}. Доступен один возврат. Следующее успешное восстановление заменит эту точку.`}</Text>
    {point !== null ? <>
      <AppButton label="Подготовить возврат" variant="secondary" disabled={busy || state.preview !== null} onPress={() => { void restore.previewReturn(); }} />
      <AppButton label="Удалить точку возврата" variant="ghost" disabled={busy || state.preview !== null} onPress={() => {
        Alert.alert("Удалить точку возврата?", "Вернуть состояние перед последним восстановлением через эту точку больше не получится. Сохранённые файлы копий останутся.",
          [{ text: "Отмена", style: "cancel" }, { text: "Удалить", style: "destructive", onPress: () => { void restore.deletePoint(point.id); } }]);
      }} />
    </> : null}
    <Text style={body}>Точка возврата хранится внутри приложения и удаляется вместе с ним. Для переустановки сохраняйте отдельные файлы копий.</Text>
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 12 }, body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 } });
