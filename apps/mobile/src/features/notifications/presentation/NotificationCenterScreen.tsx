import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Trash2 } from "lucide-react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { AppButton, EmptyState, InlineNotice, LoadingState } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { CenterEvent } from "../domain/CenterModel.ts";
import type { NotificationCenterPort } from "../domain/NotificationCenterPort.ts";

const UNDO_MS = 5000;

function whenText(occursAt: string, now: Date): string {
  const at = new Date(occursAt);
  const sameDay = at.toDateString() === now.toDateString();
  const pad = (value: number) => String(value).padStart(2, "0");
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
  return sameDay ? clock : `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${clock}`;
}

function Row({ item, now, onOpen, onDismiss }: Readonly<{ item: CenterEvent; now: Date; onOpen: (item: CenterEvent) => void; onDismiss: (item: CenterEvent) => void }>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  const unread = item.readAt === null;
  return (
    <ReanimatedSwipeable overshootRight={false} overshootLeft={false} friction={2}
      onSwipeableOpen={() => onDismiss(item)}
      renderRightActions={() => <View style={[styles.swipe, { backgroundColor: colors.danger }]}><Trash2 size={20} color={colors.onAccentFill} /></View>}
      renderLeftActions={() => <View style={[styles.swipe, { backgroundColor: colors.danger }]}><Trash2 size={20} color={colors.onAccentFill} /></View>}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${unread ? "Непрочитано. " : ""}${item.title}. ${item.body}. ${whenText(item.occursAt, now)}`}
        accessibilityHint="Открыть и отметить прочитанным. Смахните, чтобы убрать из ленты" onPress={() => onOpen(item)}
        style={[styles.card, { backgroundColor: unread ? colors.accentSoft : colors.surface, borderColor: colors.border }]}>
        <View style={[styles.dot, { backgroundColor: unread ? colors.accentFill : "transparent" }]} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
          <Text style={[styles.body, { color: colors.textSecondary }]}>{item.body}</Text>
        </View>
        <Text style={[styles.when, { color: colors.textMuted }]}>{whenText(item.occursAt, now)}</Text>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

/**
 * Центр уведомлений (§54): лента локальных событий. Открытие строки отмечает её прочитанной, открытие самого центра — нет;
 * свайп убирает строку (с коротким «Отменить»). Ни прочтение, ни свайп не меняют записи, абонементы и исходы (§54.2).
 * Неудачная запись статуса показывается ошибкой и не выдаётся за сохранённую.
 */
export function NotificationCenterScreen({ center, onOpenSettings, onOpenEvent }: Readonly<{ center: NotificationCenterPort; onOpenSettings: () => void;
  /** Переход к источнику события (запись в календаре и т. п.); отметка «прочитано» ставится до перехода. */
  onOpenEvent?: (item: CenterEvent) => void }>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  const [feed, setFeed] = useState<readonly CenterEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<CenterEvent | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [now] = useState(() => new Date());

  const reload = useCallback(() => {
    center.listFeed().then((rows) => { setFeed(rows); setFailed(false); }, () => setFailed(true));
  }, [center]);
  useEffect(() => {
    reload();
    const off = center.subscribeCommittedChanges((change) => { if (change.scope === "EVENTS") reload(); });
    return () => { off(); if (undoTimer.current !== null) clearTimeout(undoTimer.current); };
  }, [center, reload]);

  const attempt = async (action: () => Promise<unknown>) => {
    setError(null);
    try { await action(); } catch { setError("Не удалось сохранить изменение. Лента не изменена."); reload(); }
  };

  const open = (item: CenterEvent) => {
    void attempt(async () => {
      if (item.readAt === null) await center.markRead(item.id);
      onOpenEvent?.(item);
    });
  };
  const dismiss = (item: CenterEvent) => {
    void attempt(async () => {
      await center.dismiss(item.id);
      setUndo(item);
      if (undoTimer.current !== null) clearTimeout(undoTimer.current);
      undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS);
    });
  };
  const unreadCount = useMemo(() => feed?.filter((item) => item.readAt === null).length ?? 0, [feed]);
  const hasRead = useMemo(() => feed?.some((item) => item.readAt !== null) === true, [feed]);

  if (failed) return <View style={styles.pad}><InlineNotice kind="error">Не удалось загрузить уведомления.</InlineNotice><AppButton variant="secondary" label="Повторить" onPress={reload} /></View>;
  if (feed === null) return <LoadingState label="Загружаем уведомления…" />;

  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <FlatList data={feed} keyExtractor={(item) => item.id} contentContainerStyle={styles.list}
        ListHeaderComponent={<View style={styles.head}>
          {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
          <View style={styles.actions}>
            <View style={styles.action}><AppButton compact size="small" variant="secondary" label="Отметить всё прочитанным" disabled={unreadCount === 0}
              onPress={() => { void attempt(() => center.markAllRead()); }} /></View>
            <View style={styles.action}><AppButton compact size="small" variant="ghost" label="Очистить прочитанные" disabled={!hasRead}
              onPress={() => { void attempt(() => center.clearRead()); }} /></View>
          </View>
        </View>}
        ListEmptyComponent={<EmptyState reason="no-data" title="Пока нет уведомлений" body="Здесь появятся напоминания о записях и дежурствах и записи, ожидающие выбора исхода." />}
        ListFooterComponent={<View style={styles.foot}><AppButton variant="secondary" label="Настройки уведомлений" onPress={onOpenSettings} /></View>}
        renderItem={({ item }) => <Row item={item} now={now} onOpen={open} onDismiss={dismiss} />} />
      {undo !== null ? <View style={[styles.undo, { backgroundColor: colors.surfaceRaised, borderColor: colors.border }]} accessibilityLiveRegion="polite">
        <Text style={[styles.undoText, { color: colors.textPrimary }]}>Убрано из ленты</Text>
        <AppButton compact size="small" variant="ghost" label="Отменить" onPress={() => {
          const item = undo;
          setUndo(null);
          void attempt(() => center.undoDismiss(item.id));
        }} />
      </View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  pad: { padding: 16, gap: 12 },
  list: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24, gap: 8 },
  head: { gap: 8, marginBottom: 4 },
  actions: { flexDirection: "row", gap: 8 },
  action: { flex: 1 },
  foot: { marginTop: 12 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, minHeight: 64 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 18 },
  body: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  when: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  swipe: { width: 72, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  undo: { position: "absolute", left: 16, right: 16, bottom: 16, borderWidth: 1, borderRadius: 12, paddingLeft: 14, paddingRight: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  undoText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
});
