import { useCallback, useSyncExternalStore } from "react";
import { Pressable, Text, View } from "react-native";
import type { AutomaticBackupErrorCode, AutomaticBackupPort } from "../../features/backup/public.ts";
import { AppButton, InlineNotice } from "../../shared/ui/components/public.ts";
import { SectionHeading } from "../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

const errors: Record<AutomaticBackupErrorCode, string> = {
  AUTO_UNAVAILABLE: "Автоматические копии недоступны в этой сборке приложения.",
  AUTO_NOT_READY: "Проверка копий продолжится после завершения текущей операции.",
  AUTO_FOLDER_UNAVAILABLE: "Автоматические копии приостановлены: папка недоступна. Повторите проверку или выберите другую папку.",
  AUTO_SOURCE_UNAVAILABLE: "Не удалось подготовить автоматическую копию. Проверьте свободное место и повторите попытку. Рабочие данные сохранены.",
  AUTO_VERIFICATION_FAILED: "Копия не прошла проверку. Прежние файлы сохранены. Повторите проверку или выберите другую папку.",
  AUTO_STATE_UNAVAILABLE: "Не удалось проверить список автоматических копий. Прежние файлы сохранены. Повторите проверку.",
  AUTO_CLOCK_CHANGED: "Автоматические копии приостановлены после изменения даты или часового пояса. Проверьте настройки времени телефона.",
  AUTO_CLEANUP_PENDING: "Новая копия сохранена, но очистка прежних версий не завершена. Повторите проверку.",
};
export function AutomaticBackupSection({ backup, blocked }: Readonly<{ backup: AutomaticBackupPort; blocked: boolean }>) {
  const subscribe = useCallback((listener: () => void) => backup.subscribe(listener), [backup]);
  const snapshot = useCallback(() => backup.state, [backup]); const state = useSyncExternalStore(subscribe, snapshot);
  const { palette } = usePrototypeTheme();
  const body = { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: palette.tokens.textSecondary };
  return <>
    <SectionHeading>Автоматические копии</SectionHeading>
    <Text style={body}>Проверяем изменения каждые 30 минут, пока приложение активно. Сохраняем последнюю копию и две дневные версии при их наличии.</Text>
    {!state.available ? <InlineNotice>{errors.AUTO_UNAVAILABLE}</InlineNotice> : null}
    {state.phase !== "IDLE" ? <InlineNotice>Проверяем и сохраняем автоматическую копию…</InlineNotice> : null}
    {state.error !== null ? <InlineNotice kind="error">{errors[state.error]}</InlineNotice> : null}
    {state.lastSaved !== null ? <Text style={body}>Последняя автоматическая копия: {new Date(state.lastSaved.createdAt).toLocaleString("ru-RU")} · Версий: {state.versions} из 3.</Text> : null}
    {state.available && state.lastSaved === null ? <Text style={body}>Автоматическая копия пока не создана.</Text> : null}
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
  return <View accessibilityRole="alert" style={{ borderWidth: 1, borderColor: palette.tokens.warning,
    backgroundColor: palette.tokens.surface, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 8 }}>
    <Text style={{ flex: 1, fontFamily: fonts.regular, fontSize: 13, color: palette.tokens.textPrimary }}>Резервные копии требуют внимания.</Text>
    <Pressable accessibilityRole="button" onPress={onOpen} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}>
      <Text style={{ color: palette.tokens.textPrimary }}>Подробнее</Text>
    </Pressable>
  </View>;
}
