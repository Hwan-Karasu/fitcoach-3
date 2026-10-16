import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice, SearchField, SelectionChip,
  StatusTag } from "../../../shared/ui/components/public.ts";
import { EmptyPanel, PrototypeScreen } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ArchiveSortMode, ClientArchivePort, ClientDeletionManifest } from
  "../domain/ClientArchivePort.ts";
import type { ClientRecord, ClientRepositoryPort } from "../domain/ClientRepositoryPort.ts";
import type { ClientRosterPort, ClientRosterRow, RosterSortMode } from "../domain/ClientRosterPort.ts";
import type { ClientListQueryPort } from "../domain/ClientRosterReadModel.ts";
import { formatArchivedSince, localCalendarDate, permanentDeleteDescription, presentArchivedClients,
  presentClientRoster } from "../domain/ClientRosterPresentation.ts";

function clientMark(row: ClientRecord): string {
  if (row.emoji) return row.emoji;
  return row.displayName.trim().split(/\s+/u).slice(0, 2)
    .map((part) => Array.from(part)[0]?.toLocaleUpperCase("ru") ?? "").join("") || "?";
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

export function ClientsRosterPreview({ onOpenCreate, onOpenEdit, onOpenClient, repository,
  readModel }: Readonly<{
  onOpenCreate: () => void;
  onOpenEdit: (clientId: string) => void;
  onOpenClient: (clientId: string) => void;
  repository: ClientRosterPort;
  readModel: ClientListQueryPort;
}>) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [today, setToday] = useState(() => localCalendarDate(new Date()));
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const snapshot = useSyncExternalStore(readModel.subscribe, readModel.getSnapshot,
    readModel.getSnapshot);
  const data = snapshot.status === "ready" ? snapshot.data : null;
  const activeSort = data?.sort ?? "NAME";
  const birthdaySettings = data?.birthday ?? defaultBirthday;

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

  const roster = useMemo(() => data === null ? null : presentClientRoster({
    rows: data.rows, search: query, sort: activeSort, today,
    birthday: birthdaySettings, dismissals: data.dismissals,
  }), [activeSort, birthdaySettings, data, query, today]);
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

  const renderRow = (row: ClientRosterRow, birthdayBadge: string | null = null,
    birthdayOccurrence: string | null = null) => (
    <View key={row.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.identityRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Открыть карточку клиента ${row.displayName}`}
          onPress={() => onOpenClient(row.id)} style={styles.identityMain}>
          <Text accessibilityElementsHidden style={[styles.avatar,
            { color: colors.textPrimary, backgroundColor: colors.surfaceRaised }]}>{clientMark(row)}</Text>
          <View style={styles.cardText}>
            <Text style={[styles.name, { color: colors.textPrimary }]}>{row.displayName}</Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>Открыть карточку ›</Text>
          </View>
        </Pressable>
        {birthdayOccurrence !== null ? (
          <AppIconButton label="Убрать из закреплённых" disabled={dismissingId !== null}
            icon={<View style={styles.unpinIcon}>
              <Text style={styles.pinGlyph}>📌</Text>
              <View style={[styles.pinSlash, { backgroundColor: colors.accentInk }]} />
            </View>}
            onPress={() => { void dismissBirthday(row.id, birthdayOccurrence); }} />
        ) : null}
      </View>
      {birthdayBadge !== null ? <StatusTag kind="warning" label={birthdayBadge} /> : null}
      <AppButton variant="secondary" label="Изменить" onPress={() => onOpenEdit(row.id)} />
    </View>
  );

  return (
    <PrototypeScreen>
      <SearchField accessibilityLabel="Поиск по клиентам" query={query} onChangeQuery={setQuery} />
      <View style={styles.filters}>
        <SelectionChip group="Сортировка" label="Имя А–Я" selected={activeSort === "NAME"}
          onPress={() => { void chooseActiveSort("NAME"); }} />
        <SelectionChip group="Сортировка" label="Недавно открытые" selected={activeSort === "RECENT"}
          onPress={() => { void chooseActiveSort("RECENT"); }} />
      </View>
      <AppButton label="Создать карточку" onPress={onOpenCreate} />
      <ListLoadState snapshot={snapshot} error={error}
        onRetry={() => { setError(null); readModel.refresh(); }} />
      {roster !== null && visibleCount === 0 ? (
        <EmptyPanel
          title={query.trim() ? "Ничего не найдено" : "Пока нет клиентов"}
          body={query.trim() ? "Попробуйте другое имя или очистите поиск." : "Создайте первую карточку клиента."}
        />
      ) : null}
      {roster && roster.birthday.length > 0 ? (
        <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Дни рождения</Text>
      ) : null}
      {roster?.birthday.map((entry) => renderRow(entry.client, entry.birthdayBadge,
        entry.birthdayOccurrence))}
      {roster?.recent ? <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Недавно открытый</Text> : null}
      {roster?.recent ? renderRow(roster.recent.client, roster.recent.birthdayBadge) : null}
      {roster?.regular.map((entry) => renderRow(entry.client, entry.birthdayBadge))}
    </PrototypeScreen>
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
  const [query, setQuery] = useState("");
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
      <SearchField accessibilityLabel="Поиск по архиву клиентов" query={query} onChangeQuery={setQuery} />
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
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  message: { fontSize: 14, lineHeight: 20 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 12 },
  identityRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  identityMain: { flex: 1, minHeight: 52, flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { minWidth: 52, minHeight: 52, borderRadius: 26, overflow: "hidden",
    textAlign: "center", textAlignVertical: "center", fontSize: 21, lineHeight: 52 },
  cardText: { flexShrink: 1, gap: 2 },
  name: { fontSize: 17, lineHeight: 23, fontWeight: "700" },
  detail: { fontSize: 12, lineHeight: 18 },
  sectionLabel: { fontSize: 12, lineHeight: 17, fontWeight: "700" },
  unpinIcon: { width: 26, height: 28, alignItems: "center", justifyContent: "center" },
  pinGlyph: { fontSize: 20, lineHeight: 26 },
  pinSlash: { position: "absolute", width: 28, height: 2, transform: [{ rotate: "-45deg" }] },
});
