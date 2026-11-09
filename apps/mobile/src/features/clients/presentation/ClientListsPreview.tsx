import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppState, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Cake, PinOff } from "lucide-react-native";
import { AppButton, AppIconButton, ClientRosterCard, BottomSheet, ChoiceGrid, EmptyState,
  InlineNotice,
  ListSectionHeader, SkeletonList, useHeaderScrollHandler, useHeaderSearch, useFocusGatedVersion,
  type DropdownOption } from "../../../shared/ui/components/public.ts";
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
import { shadow } from "../../../shared/ui/theme/style.ts";
import { EMPTY_ROSTER_FILTERS, rosterFilterCount, summarizeRoster, type ClientRosterFilters, type RosterRing } from "../domain/ClientRosterFilters.ts";
import { ClientRosterFiltersDialog } from "./ClientRosterFiltersDialog.tsx";
import { RosterSearchBar } from "./RosterSearchBar.tsx";
import { RosterSummaryCard } from "./RosterSummaryCard.tsx";

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

const archiveSortOptions: readonly DropdownOption<ArchiveSortMode>[] = [
  { value: "ARCHIVED_AT", label: "Недавно архивированные" },
  { value: "NAME", label: "Имя А–Я" },
];

const metricLabel: Readonly<Record<RosterMetricId, string>> = {
  weight: "Вес", calories: "Калории", steps: "Шаги", fatPercent: "% жира",
  nextAppointment: "Следующее занятие", lastTraining: "Последняя тренировка", credits: "Абонемент",
};

/**
 * Сводка других владельцев для видимых карточек: перечитывается при их изменениях и в момент,
 * когда закончится ближайшая сегодняшняя запись (GetNextEligibilityTransitionAt без частого опроса).
 */
function useRosterOverview(port: RosterOverviewPort, clientIds: readonly string[], today: string): RosterOverview | null {
  const { clientCards } = usePrototypeTheme();
  const metricKey = clientCards.metricIds.join("|");
  const [overview, setOverview] = useState<RosterOverview | null>(null);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const key = clientIds.join("|");
  // Изменения других владельцев (в том числе каждый подход дневника) на скрытом экране не пересчитывают сводку всех клиентов: один раз при возврате.
  const changes = useFocusGatedVersion(port.subscribe);
  useEffect(() => {
    const request = ++generation.current;
    port.load(key === "" ? [] : key.split("|"), new Date(), clientCards.metricIds).then((value) => {
      if (request === generation.current) setOverview(value);
    }, () => undefined);
  }, [port, key, today, tick, changes, metricKey, clientCards.metricIds]);
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [ring, setRing] = useState<RosterRing | null>(null);
  const [filters, setFilters] = useState<ClientRosterFilters>(EMPTY_ROSTER_FILTERS);
  const filterCount = rosterFilterCount(filters);
  const onScroll = useHeaderScrollHandler();
  const [today, setToday] = useState(() => localCalendarDate(new Date()));
  const { palette, clientCards } = usePrototypeTheme();
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

  const factsPending = overview === null && (filters.health !== "ALL" || filters.credit !== "ALL" || ring !== null);
  const summary = useMemo(() => overview === null ? null : summarizeRoster(overview, activeIds), [overview, activeIds]);
  const present = useCallback((next: ClientRosterFilters) => data === null ? null : presentClientRoster({
    rows: data.rows, search: query, sort: activeSort, today,
    birthday: birthdaySettings, dismissals: data.dismissals,
    filters: next, overview, ring,
  }), [activeSort, birthdaySettings, data, query, today, overview, ring]);
  const roster = useMemo(() => factsPending ? null : present(filters), [factsPending, present, filters]);
  const visibleCount = (roster?.birthday.length ?? 0) + (roster?.recent ? 1 : 0)
    + (roster?.regular.length ?? 0);
  const countFor = (next: ClientRosterFilters): number | null => {
    if (overview === null && (next.health !== "ALL" || next.credit !== "ALL")) return null;
    const shown = present(next);
    return shown === null ? 0 : shown.birthday.length + (shown.recent ? 1 : 0) + shown.regular.length;
  };

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
        subtitle={age === null ? null : formatYears(age)} restricted={clientCards.showHealthBadge && (facts?.restricted ?? false)}
        highlight={birthdayText} highlightIcon={(color) => <Cake size={14} color={color} strokeWidth={2} />}
        metrics={clientCards.metricIds.map((id) => ({ label: metricLabel[id],
          value: facts?.metrics.find((metric) => metric.id === id)?.value ?? null }))}
        onOpen={onOpenClient} emoji={row.emoji}
        onChangeEmoji={(_, emoji) => { void changeEmoji(row, emoji); }}
        action={birthdayOccurrence === null ? undefined : (
          <AppIconButton label={`Убрать ${row.displayName} из закреплённых`} disabled={dismissingId !== null}
            icon={<PinOff size={20} color={colors.textSecondary} strokeWidth={1.8} />}
            onPress={() => { void dismissBirthday(row.id, birthdayOccurrence); }} />
        )} />
    );
  };

  const narrowed = filterCount > 0 || ring !== null;
  return (
    <View style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled" onScroll={onScroll} scrollEventThrottle={16}
        onScrollEndDrag={onScroll} onMomentumScrollEnd={onScroll}>
        <RosterSummaryCard summary={summary} activeCount={activeIds.length} ring={ring}
          onToggle={(next) => setRing((current) => current === next ? null : next)} />
        <ListLoadState snapshot={snapshot} error={error}
          onRetry={() => { setError(null); readModel.refresh(); }} />
        {snapshot.status === "loading" ? <SkeletonList label="Загружаем клиентов" /> : null}
        {factsPending ? <SkeletonList label="Загружаем данные фильтров" /> : null}
        {roster !== null && visibleCount === 0 ? (
          narrowed
            ? <EmptyState reason="no-match" title="Никого не найдено" body="Нет клиентов, подходящих под выбранные условия."
              action={{ label: "Сбросить фильтры", onPress: () => { setFilters(EMPTY_ROSTER_FILTERS); setRing(null); setQuery(""); } }} />
            : query.trim()
              ? <EmptyState reason="no-match" title="Ничего не найдено" body="Попробуйте другое имя или очистите поиск."
                action={{ label: "Очистить поиск", onPress: () => setQuery("") }} />
              : <EmptyState reason="no-data" title="Клиентов пока нет" body="Создайте первую карточку клиента."
                action={{ label: "Создать карточку клиента", onPress: onOpenCreate }} />
        ) : null}
        {roster && visibleCount > 0 && (roster.searching || narrowed)
          ? <ListSectionHeader title="Найдено" count={visibleCount} /> : null}
        {roster?.birthday.map((entry) => renderRow(entry.client, entry.birthdayText,
          entry.birthdayOccurrence))}
        {roster?.recent ? renderRow(roster.recent.client, roster.recent.birthdayBadge === null ? null
          : roster.recent.birthdayText, null) : null}
        {roster?.regular.map((entry) => renderRow(entry.client, entry.birthdayBadge === null ? null : entry.birthdayText))}
      </ScrollView>
      <RosterSearchBar query={query} onChangeQuery={setQuery} placeholder="Найти клиента" searchLabel="Поиск по клиентам"
        menuLabel="Фильтры клиентов" menuCount={filterCount} onOpenMenu={() => setFiltersOpen(true)} onCreate={onOpenCreate} />
      <ClientRosterFiltersDialog visible={filtersOpen} filters={filters} sort={activeSort} countFor={countFor}
        onApply={setFilters} onSort={(mode) => { void chooseActiveSort(mode); }}
        onReset={() => { setFilters(EMPTY_ROSTER_FILTERS); setRing(null); }} error={error} onClose={() => setFiltersOpen(false)} />
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
  const { query, setQuery } = useHeaderSearch();
  const { width, fontScale } = useWindowDimensions();
  const [sortOpen, setSortOpen] = useState(false);
  const onScroll = useHeaderScrollHandler();
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

  const stacked = fontScale > 1.15 || width < 340;
  return (
    <View style={styles.screen}>
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      <ListLoadState snapshot={snapshot} error={error}
        onRetry={() => { setError(null); readModel.refresh(); }} />
      {visible !== null && visible.length === 0 ? (
        <EmptyState reason={total > 0 ? "no-match" : "no-data"}
          title={total > 0 ? "Ничего не найдено" : "Архив пуст"}
          body={total > 0 ? "Попробуйте другое имя или очистите поиск."
            : "Архивированные карточки появятся здесь."}
          action={query.trim() ? { label: "Очистить поиск", onPress: () => setQuery("") } : undefined}
        />
      ) : null}
      {visible?.map((row) => (
        <View key={row.id} style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
          <View style={styles.identityMain}>
            <Text accessibilityElementsHidden style={[styles.avatar, { color: colors.accentInk, backgroundColor: colors.accentSoft }]}>{clientMark(row)}</Text>
            <View style={styles.cardText}>
              <Text numberOfLines={2} style={[styles.name, { color: colors.textPrimary }]}>{row.displayName}</Text>
              <Text style={[styles.detail, { color: colors.textSecondary }]}>
                {formatArchivedSince(row.archivedAt)}
              </Text>
            </View>
          </View>
          <View style={[styles.actions, stacked ? styles.actionsStacked : null]}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Вернуть в клиенты: ${row.displayName}`}
              accessibilityState={{ disabled: busyId !== null, busy: busyId === row.id }} disabled={busyId !== null}
              onPress={() => { void restore(row); }}
              style={({ pressed }) => [styles.action, stacked ? null : styles.actionRow, { backgroundColor: colors.accentSoft, opacity: busyId !== null ? 0.5 : pressed ? 0.85 : 1 }]}>
              <Text numberOfLines={2} style={[styles.actionText, { color: colors.onAccentSoft }]}>Вернуть в клиенты</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Удалить окончательно: ${row.displayName}`}
              accessibilityState={{ disabled: busyId !== null }} disabled={busyId !== null}
              onPress={() => { void requestDelete(row); }}
              style={({ pressed }) => [styles.action, stacked ? null : styles.actionRow, { borderWidth: 1.5, borderColor: colors.danger, opacity: busyId !== null ? 0.5 : pressed ? 0.85 : 1 }]}>
              <Text numberOfLines={2} style={[styles.actionText, { color: colors.danger }]}>Удалить окончательно</Text>
            </Pressable>
          </View>
        </View>
      ))}
      </ScrollView>
      <RosterSearchBar query={query} onChangeQuery={setQuery} placeholder="Найти в архиве" searchLabel="Поиск по архиву"
        menuLabel="Сортировка архива" onOpenMenu={() => setSortOpen(true)} />
      <BottomSheet visible={sortOpen} title="Сортировка архива" onClose={() => setSortOpen(false)}
        footer={error === null ? undefined : <Text accessibilityRole="alert" style={[styles.message, { color: colors.danger, textAlign: "center" }]}>{error}</Text>}>
        <ChoiceGrid group="Сортировка архива" columns={2} selected={[sort]} items={archiveSortOptions.map((option) => ({ id: option.value, label: option.label }))}
          onPress={(id) => { void chooseSort(id as ArchiveSortMode); }} />
      </BottomSheet>
      <BottomSheet visible={pendingDelete !== null} title={`Удалить «${pendingDelete?.displayName ?? ""}» окончательно?`}
        onClose={() => { if (!deleting) setPendingDelete(null); }}
        footer={<View style={styles.actions}>
          <View style={styles.actionRow}><AppButton variant="secondary" label="Отмена" disabled={deleting} onPress={() => setPendingDelete(null)} /></View>
          <View style={styles.actionRow}><AppButton variant="destructive" label="Удалить окончательно" busy={deleting}
            onPress={() => { void confirmDelete(); }} /></View>
        </View>}>
        <Text style={[styles.message, { color: colors.textPrimary }]}>{pendingDelete === null ? "" : permanentDeleteDescription(pendingDelete)}</Text>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 96, gap: 8 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  message: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  card: { borderRadius: 26, padding: 14, gap: 12 },
  actions: { flexDirection: "row", gap: 8 },
  actionsStacked: { flexDirection: "column" },
  actionRow: { flex: 1, minWidth: 0 },
  action: { minHeight: 44, borderRadius: 22, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  actionText: { fontFamily: fonts.bold, fontSize: 13, lineHeight: 17, textAlign: "center" },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  identityMain: { flex: 1, minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { minWidth: 52, minHeight: 52, borderRadius: 18, overflow: "hidden",
    textAlign: "center", textAlignVertical: "center", fontFamily: fonts.bold, fontSize: 18, lineHeight: 52 },
  cardText: { flexShrink: 1, gap: 2 },
  name: { fontSize: 15, lineHeight: 21, fontFamily: fonts.bold },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  sectionLabel: { fontSize: 12, lineHeight: 16, fontFamily: fonts.bold },
  unpinIcon: { width: 26, height: 28, alignItems: "center", justifyContent: "center" },
  pinGlyph: { fontFamily: fonts.regular, fontSize: 18, lineHeight: 23 },
  pinSlash: { position: "absolute", width: 28, height: 2, transform: [{ rotate: "-45deg" }] },
});
