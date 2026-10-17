import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppState, ScrollView, StyleSheet, Text, View } from "react-native";
import { Cake, CalendarClock, CalendarDays, Dumbbell, PinOff, Plus, Ticket } from "lucide-react-native";
import { AppButton, AppIconButton, ClientRosterCard, ConfirmDialog, EmptyState, FilterPill, FloatingActionButton,
  InlineNotice,
  ListSectionHeader, DropdownMenu, SelectionChip, SkeletonList, useHeaderScrollHandler, useHeaderSearch,
  type DropdownOption } from "../../../shared/ui/components/public.ts";
import { EmptyPanel, PrototypeScreen } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ArchiveSortMode, ClientArchivePort, ClientDeletionManifest } from
  "../domain/ClientArchivePort.ts";
import type { ClientRecord, ClientRepositoryPort } from "../domain/ClientRepositoryPort.ts";
import type { ClientRosterPort, ClientRosterRow, RosterSortMode } from "../domain/ClientRosterPort.ts";
import type { ClientListQueryPort } from "../domain/ClientRosterReadModel.ts";
import type { RosterMetricId, RosterOverview, RosterOverviewPort } from "../domain/ClientRosterOverview.ts";
import { ageOn, formatArchivedSince, formatYears, localCalendarDate, permanentDeleteDescription, presentArchivedClients,
  presentClientRoster } from "../domain/ClientRosterPresentation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

function initialsOf(displayName: string): string {
  return displayName.trim().split(/\s+/u).slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase("ru") ?? "").join("") || "?";
}

function clientMark(row: ClientRecord): string {
  return row.emoji ?? initialsOf(row.displayName);
}

const defaultBirthday = { birthdayPinEnabled: true, birthdayPinLeadDays: 14,
  showBirthdayBadge: true } as const;

function ListLoadState({ snapshot, error, onRetry }: Readonly<{
  snapshot: ReturnType<ClientListQueryPort["getSnapshot"]>;
  error: string | null;
  onRetry: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const failed = error !== null || snapshot.status === "error"
    || (snapshot.status === "ready" && snapshot.refreshFailed);
  return <>
    {failed ? (
      <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger }]}>
        {error ?? "Не удалось обновить список. Последние загруженные данные сохранены."}
      </Text>
    ) : null}
    {failed ? <AppButton variant="secondary" label="Обновить список" onPress={onRetry} /> : null}
    {snapshot.status === "loading" ? (
      <Text style={[styles.message, { color: colors.textSecondary }]}>Загружаем клиентов…</Text>
    ) : null}
  </>;
}

const sortOptions: readonly DropdownOption<RosterSortMode>[] = [
  { value: "NAME", label: "Имя А–Я" },
  { value: "RECENT", label: "Недавно открытые" },
];

const metricLook: Readonly<Record<RosterMetricId, Readonly<{ label: string; icon: (color: string) => ReactNode }>>> = {
  nextAppointment: { label: "Следующее занятие", icon: (color) => <CalendarClock size={16} color={color} strokeWidth={1.8} /> },
  lastTraining: { label: "Последняя тренировка", icon: (color) => <Dumbbell size={16} color={color} strokeWidth={1.8} /> },
  credits: { label: "Абонемент", icon: (color) => <Ticket size={16} color={color} strokeWidth={1.8} /> },
};

/**
 * Сводка других владельцев для видимых карточек: перечитывается при их изменениях и в момент,
 * когда закончится ближайшая сегодняшняя запись (GetNextEligibilityTransitionAt без частого опроса).
 */
function useRosterOverview(port: RosterOverviewPort, clientIds: readonly string[], today: string): RosterOverview | null {
  const [overview, setOverview] = useState<RosterOverview | null>(null);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const key = clientIds.join("|");
  useEffect(() => {
    const request = ++generation.current;
    port.load(key === "" ? [] : key.split("|"), new Date()).then((value) => {
      if (request === generation.current) setOverview(value);
    }, () => undefined);
  }, [port, key, today, tick]);
  useEffect(() => port.subscribe(() => setTick((value) => value + 1)), [port]);
  useEffect(() => {
    if (overview === null) return undefined;
    const now = new Date();
    const nowMinute = now.getHours() * 60 + now.getMinutes();
    const moments = [...overview.values()].flatMap((row) => [row.todayStartMinute, row.todayEndMinute])
      .filter((minute): minute is number => minute !== null && minute > nowMinute);
    if (moments.length === 0) return undefined;
    const wait = (Math.min(...moments) - nowMinute) * 60_000 - now.getSeconds() * 1000 + 500;
    const timer = setTimeout(() => setTick((value) => value + 1), Math.max(wait, 1000));
    return () => clearTimeout(timer);
  }, [overview]);
  return overview;
}

const groupOptions: readonly DropdownOption<"ALL">[] = [{ value: "ALL", label: "Все клиенты" }];

/** Экран «Клиенты» — эталон UI (docs/ui/screens/CLIENTS.md). */
export function ClientsRosterPreview({ onOpenCreate, onOpenClient, repository, readModel, overviewSource }: Readonly<{
  onOpenCreate: () => void;
  onOpenClient: (clientId: string) => void;
  repository: ClientRosterPort;
  readModel: ClientListQueryPort;
  overviewSource: RosterOverviewPort;
}>) {
  const { query, setQuery } = useHeaderSearch();
  const [error, setError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [toolbarHeight, setToolbarHeight] = useState(52);
  const [menu, setMenu] = useState<"sort" | "group" | null>(null);
  const groupAnchor = useRef<View>(null);
  const sortAnchor = useRef<View>(null);
  const [todayOnly, setTodayOnly] = useState(false);
  const onScroll = useHeaderScrollHandler();
  const [today, setToday] = useState(() => localCalendarDate(new Date()));
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const snapshot = useSyncExternalStore(readModel.subscribe, readModel.getSnapshot,
    readModel.getSnapshot);
  const data = snapshot.status === "ready" ? snapshot.data : null;
  const activeSort = data?.sort ?? "NAME";
  const birthdaySettings = data?.birthday ?? defaultBirthday;
  const activeIds = useMemo(() => data?.rows.filter((row) => row.lifecycle === "ACTIVE").map((row) => row.id) ?? [],
    [data]);
  const overview = useRosterOverview(overviewSource, activeIds, today);

  useEffect(() => {
    let midnightTimer: ReturnType<typeof setTimeout>;
    const scheduleMidnight = () => {
      clearTimeout(midnightTimer);
      const now = new Date();
      const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      midnightTimer = setTimeout(() => {
        setToday(localCalendarDate(new Date()));
        scheduleMidnight();
      }, tomorrow.getTime() - now.getTime() + 50);
    };
    scheduleMidnight();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        setToday(localCalendarDate(new Date()));
        scheduleMidnight();
      }
    });
    return () => { clearTimeout(midnightTimer); subscription.remove(); };
  }, []);

  useFocusEffect(useCallback(() => {
    setToday(localCalendarDate(new Date()));
  }, []));

  const todayStarts = useMemo(() => {
    if (!todayOnly) return null;
    const starts = new Map<string, number>();
    for (const [id, row] of overview ?? []) if (row.todayStartMinute !== null) starts.set(id, row.todayStartMinute);
    return starts;
  }, [overview, todayOnly]);
  const roster = useMemo(() => data === null ? null : presentClientRoster({
    rows: data.rows, search: query, sort: activeSort, today,
    birthday: birthdaySettings, dismissals: data.dismissals, todayStarts,
  }), [activeSort, birthdaySettings, data, query, today, todayStarts]);
  const visibleCount = (roster?.birthday.length ?? 0) + (roster?.recent ? 1 : 0)
    + (roster?.regular.length ?? 0);

  const chooseActiveSort = async (mode: RosterSortMode) => {
    try { await repository.setRosterSort(mode); setError(null); }
    catch { setError("Не удалось сохранить сортировку."); }
  };

  const dismissBirthday = async (clientId: string, occurrenceDate: string) => {
    if (dismissingId !== null) return;
    setDismissingId(clientId);
    try {
      await repository.dismissBirthday(clientId, occurrenceDate);
      setError(null);
    } catch { setError("Не удалось убрать закрепление. Попробуйте ещё раз."); }
    finally { setDismissingId(null); }
  };

  const changeEmoji = async (client: ClientRosterRow, emoji: string | null) => {
    if (emoji === client.emoji) return;
    try {
      await repository.changeEmoji(client.id, client.revision, emoji);
      setError(null);
    } catch (failure) {
      setError(failure instanceof Error && failure.message === "CLIENT_STALE_OR_WRONG_SCOPE"
        ? "Карточка изменилась. Список обновлён — выберите эмодзи ещё раз." : "Не удалось сменить эмодзи.");
      readModel.refresh();
    }
  };

  const renderRow = (row: ClientRosterRow, birthdayText: string | null = null,
    birthdayOccurrence: string | null = null) => {
    const age = row.birthDate === null ? null : ageOn(row.birthDate, today);
    const facts = overview?.get(row.id);
    return (
      <ClientRosterCard key={row.id} clientId={row.id} displayName={row.displayName} mark={clientMark(row)}
        subtitle={age === null ? null : formatYears(age)} restricted={facts?.restricted ?? false}
        highlight={birthdayText} highlightIcon={(color) => <Cake size={14} color={color} strokeWidth={2} />}
        metrics={facts?.metrics.map((metric) => ({ label: metricLook[metric.id].label, value: metric.value,
          icon: metricLook[metric.id].icon })) ?? []}
        onOpen={onOpenClient} emoji={row.emoji}
        onChangeEmoji={(_, emoji) => { void changeEmoji(row, emoji); }}
        action={birthdayOccurrence === null ? undefined : (
          <AppIconButton label={`Убрать ${row.displayName} из закреплённых`} disabled={dismissingId !== null}
            icon={<PinOff size={20} color={colors.textSecondary} strokeWidth={1.8} />}
            onPress={() => { void dismissBirthday(row.id, birthdayOccurrence); }} />
        )} />
    );
  };

  const sortLabel = sortOptions.find((option) => option.value === activeSort)?.label ?? "Имя А–Я";
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      {/* Фильтры висят поверх списка без собственного фона: карточки проходят под ними (UI-OWN-020). */}
      <View style={styles.toolbar} pointerEvents="box-none"
        onLayout={(event) => setToolbarHeight(event.nativeEvent.layout.height)}>
        <View style={styles.pills}>
          <FilterPill weight={1} label="Сегодня" selected={todayOnly}
            accessibilityLabel={todayOnly ? "Сегодня по расписанию, включён" : "Сегодня по расписанию"}
            icon={(color) => <CalendarDays size={16} color={color} strokeWidth={1.8} />}
            onPress={() => setTodayOnly((value) => !value)} />
          <FilterPill weight={1.4} menu expanded={menu === "group"} anchorRef={groupAnchor} label="Все клиенты" accessibilityLabel="Группа клиентов: все клиенты"
            onPress={() => setMenu("group")} />
          <FilterPill weight={1} menu expanded={menu === "sort"} anchorRef={sortAnchor} label={todayOnly ? "Время" : sortLabel}
            accessibilityLabel={todayOnly ? "Сортировка: по времени записи" : `Сортировка: ${sortLabel}`}
            onPress={() => setMenu("sort")} />
        </View>
      </View>
      <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: toolbarHeight }]}
        keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={32}>
        <ListLoadState snapshot={snapshot} error={error}
          onRetry={() => { setError(null); readModel.refresh(); }} />
        {snapshot.status === "loading" ? <SkeletonList label="Загружаем клиентов" /> : null}
        {roster !== null && visibleCount === 0 ? (
          roster.todayOnly
            ? <EmptyState reason="no-match" title="Сегодня по расписанию никого"
              body="Нет записей, которые ещё не закончились." action={{ label: "Все клиенты", onPress: () => setTodayOnly(false) }} />
            : query.trim()
              ? <EmptyState reason="no-match" title="Ничего не найдено" body="Попробуйте другое имя или очистите поиск."
                action={{ label: "Очистить поиск", onPress: () => setQuery("") }} />
              : <EmptyState reason="no-data" title="Клиентов пока нет" body="Создайте первую карточку клиента."
                action={{ label: "Создать карточку клиента", onPress: onOpenCreate }} />
        ) : null}
        {roster?.todayOnly && visibleCount > 0 ? <ListSectionHeader title="Сегодня по расписанию" count={visibleCount} /> : null}
        {roster?.searching && !roster.todayOnly && visibleCount > 0 ? <ListSectionHeader title="Найдено" count={visibleCount} /> : null}
        {roster && roster.birthday.length > 0 ? <ListSectionHeader accent title="Дни рождения" count={roster.birthday.length} /> : null}
        {roster?.birthday.map((entry) => renderRow(entry.client, entry.birthdayText,
          entry.birthdayOccurrence))}
        {roster?.recent ? <ListSectionHeader title="Недавно открывали" count={1} /> : null}
        {roster?.recent ? renderRow(roster.recent.client, roster.recent.birthdayBadge === null ? null
          : roster.recent.birthdayText) : null}
        {roster && !roster.searching && !roster.todayOnly && roster.regular.length > 0
          ? <ListSectionHeader title="Все клиенты" count={roster.regular.length} /> : null}
        {roster?.regular.map((entry) => renderRow(entry.client, entry.birthdayBadge === null ? null : entry.birthdayText))}
      </ScrollView>
      <FloatingActionButton label="Создать карточку клиента" onPress={onOpenCreate}
        icon={(color) => <Plus size={26} color={color} strokeWidth={2.2} />} />
      <DropdownMenu visible={menu === "sort"} anchor={sortAnchor} title="Сортировка" options={sortOptions} selected={activeSort}
        note={todayOnly ? "Пока включён «Сегодня», список идёт по времени записи." : undefined}
        onSelect={(mode) => { void chooseActiveSort(mode); }} onClose={() => setMenu(null)} />
      <DropdownMenu visible={menu === "group"} anchor={groupAnchor} title="Клиенты" options={groupOptions} selected="ALL"
        note="Фильтры по полу и меткам появятся, когда эти поля будут в карточке клиента."
        onSelect={() => undefined} onClose={() => setMenu(null)} />
    </View>
  );
}

function deleteErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "CLIENT_STALE_OR_WRONG_SCOPE" || code === "CLIENT_NOT_FOUND"
    || code === "CLIENT_NOT_ARCHIVED") {
    return "Карточка изменилась. Список обновлён — при необходимости повторите удаление.";
  }
  if (code === "CLIENT_DELETION_BLOCKED") {
    return "Удаление остановлено: найдены данные клиента, которые приложение пока не умеет безопасно удалить. Ничего не удалено.";
  }
  return "Не удалось удалить клиента. Ничего не удалено, попробуйте ещё раз.";
}

/** §15.3: archived card identifies the client and offers lifecycle actions only. */
export function ClientsArchivePreview({ repository, readModel }: Readonly<{
  repository: ClientRepositoryPort & ClientArchivePort;
  readModel: ClientListQueryPort;
}>) {
  const { query } = useHeaderSearch();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ClientDeletionManifest | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const snapshot = useSyncExternalStore(readModel.subscribe, readModel.getSnapshot,
    readModel.getSnapshot);
  const data = snapshot.status === "ready" ? snapshot.data : null;
  const sort = data?.archiveSort ?? "ARCHIVED_AT";
  const visible = useMemo(() => data === null ? null
    : presentArchivedClients(data.rows, query, sort), [data, query, sort]);
  const total = data?.rows.length ?? 0;

  // A result notice belongs to the visit in which the action happened.
  useFocusEffect(useCallback(() => () => setNotice(null), []));

  const chooseSort = async (mode: ArchiveSortMode) => {
    try { await repository.setArchiveSort(mode); setError(null); }
    catch { setError("Не удалось сохранить сортировку."); }
  };

  const restore = async (row: ClientRosterRow) => {
    if (busyId !== null) return;
    setBusyId(row.id);
    setNotice(null);
    try {
      await repository.setArchived(row.id, row.revision, false);
      setError(null);
      setNotice(`${row.displayName} возвращён в клиенты`);
    } catch {
      setNotice(null);
      setError("Не удалось вернуть клиента: карточка изменилась или операция не удалась. Список обновлён.");
      readModel.refresh();
    } finally { setBusyId(null); }
  };

  const requestDelete = async (row: ClientRosterRow) => {
    if (busyId !== null) return;
    setBusyId(row.id);
    setNotice(null);
    try {
      setPendingDelete(await repository.previewPermanentDelete(row.id));
      setError(null);
    } catch (failure) {
      setError(deleteErrorMessage(failure));
      readModel.refresh();
    } finally { setBusyId(null); }
  };

  const confirmDelete = async () => {
    if (pendingDelete === null || deleting) return;
    setDeleting(true);
    try {
      await repository.deleteArchivedPermanently(pendingDelete.clientId, pendingDelete.revision);
      setError(null);
      setNotice(`${pendingDelete.displayName} удалён окончательно`);
    } catch (failure) {
      setNotice(null);
      setError(deleteErrorMessage(failure));
      readModel.refresh();
    } finally {
      setPendingDelete(null);
      setDeleting(false);
    }
  };

  return (
    <PrototypeScreen>
      <View style={styles.filters}>
        <SelectionChip group="Сортировка" label="Сначала недавно архивированные"
          selected={sort === "ARCHIVED_AT"} onPress={() => { void chooseSort("ARCHIVED_AT"); }} />
        <SelectionChip group="Сортировка" label="По имени А–Я" selected={sort === "NAME"}
          onPress={() => { void chooseSort("NAME"); }} />
      </View>
      {data !== null && total > 0 ? (
        <Text style={[styles.message, { color: colors.textSecondary }]}>В архиве: {total}</Text>
      ) : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      <ListLoadState snapshot={snapshot} error={error}
        onRetry={() => { setError(null); readModel.refresh(); }} />
      {visible !== null && visible.length === 0 ? (
        <EmptyPanel
          title={total > 0 ? "Ничего не найдено" : "Архив пуст"}
          body={total > 0 ? "Попробуйте другое имя или очистите поиск."
            : "Архивированные карточки появятся здесь."}
        />
      ) : null}
      {visible?.map((row) => (
        <View key={row.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.identityMain}>
            <Text accessibilityElementsHidden style={[styles.avatar,
              { color: colors.textPrimary, backgroundColor: colors.surfaceRaised }]}>{clientMark(row)}</Text>
            <View style={styles.cardText}>
              <Text style={[styles.name, { color: colors.textPrimary }]}>{row.displayName}</Text>
              <Text style={[styles.detail, { color: colors.textSecondary }]}>
                {formatArchivedSince(row.archivedAt)}
              </Text>
            </View>
          </View>
          <AppButton variant="secondary" label="Вернуть в клиенты" busy={busyId === row.id}
            disabled={busyId !== null} disabledReason="Дождитесь завершения операции"
            onPress={() => { void restore(row); }} />
          <AppButton variant="destructive" label="Удалить окончательно"
            disabled={busyId !== null} disabledReason="Дождитесь завершения операции"
            onPress={() => { void requestDelete(row); }} />
        </View>
      ))}
      <ConfirmDialog visible={pendingDelete !== null} confirmBusy={deleting} destructive
        title={`Удалить «${pendingDelete?.displayName ?? ""}» окончательно?`}
        description={pendingDelete === null ? "" : permanentDeleteDescription(pendingDelete)}
        confirmLabel="Удалить окончательно"
        onCancel={() => setPendingDelete(null)} onConfirm={() => { void confirmDelete(); }} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // Нижний отступ — чтобы последняя карточка не уходила под плавающую кнопку.
  toolbar: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 1, paddingHorizontal: 16, paddingTop: 4,
    paddingBottom: 8, gap: 8 },
  content: { paddingHorizontal: 16, paddingTop: 0, paddingBottom: 88, gap: 8 },
  pills: { flexDirection: "row", alignItems: "center", gap: 8 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  message: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 12 },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  identityMain: { flex: 1, minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { minWidth: 52, minHeight: 52, borderRadius: 26, overflow: "hidden",
    textAlign: "center", textAlignVertical: "center", fontFamily: fonts.regular, fontSize: 21, lineHeight: 52 },
  cardText: { flexShrink: 1, gap: 2 },
  name: { fontSize: 17, lineHeight: 23, fontFamily: fonts.bold },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  sectionLabel: { fontSize: 12, lineHeight: 17, fontFamily: fonts.bold },
  unpinIcon: { width: 26, height: 28, alignItems: "center", justifyContent: "center" },
  pinGlyph: { fontFamily: fonts.regular, fontSize: 20, lineHeight: 26 },
  pinSlash: { position: "absolute", width: 28, height: 2, transform: [{ rotate: "-45deg" }] },
});
