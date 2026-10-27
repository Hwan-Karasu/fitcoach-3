import { useEffect, useMemo, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, ChoiceSegments, ConfirmDialog, InlineNotice, LoadingState, SearchField, SelectionChip, StatusTag,
  TextField } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { APPOINTMENT_DURATIONS, SLOT_MINUTES, type Appointment, type AppointmentInput, type AppointmentOutcome, type CalendarSettings,
  type CancelSettlement, type GuestLinkRequest, type LocalDate, type SessionType } from "../domain/CalendarModel.ts";
import type { CalendarAppointmentCredit, CalendarBookingCredit, CalendarCreditPort } from
  "../domain/CalendarCreditPort.ts";
import type { CalendarParticipant, CalendarParticipantDirectoryPort } from
  "../domain/CalendarParticipantDirectoryPort.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { addDays, appointmentStarted, formatMinute, overlaps } from "../domain/CalendarRules.ts";
import { calendarErrorMessage, dayTitle, outcomeTag } from "./calendarPresentation.ts";
import { useOfferCancelUndo } from "./CancelUndo.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";

interface Loaded {
  readonly settings: CalendarSettings;
  readonly types: readonly SessionType[];
  readonly people: readonly CalendarParticipant[];
  readonly existing: Appointment | null;
  readonly firstFree: number;
}

function ParticipantSearch({ query, onQuery, matches, selectedId, onSelect, label, disabled = false }: Readonly<{
  query: string; onQuery: (value: string) => void; matches: readonly CalendarParticipant[];
  selectedId: string | null; onSelect: (id: string) => void; label: string; disabled?: boolean;
}>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  return <View style={styles.search} pointerEvents={disabled ? "none" : "auto"}>
    <SearchField accessibilityLabel={label} query={query} onChangeQuery={onQuery} />
    {query.trim().length > 0 ? <View style={[styles.results, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={styles.resultScroll}>
        {matches.map((person) => <Pressable key={person.id} accessibilityRole="button"
          accessibilityLabel={person.displayName} accessibilityState={{ selected: selectedId === person.id }}
          onPress={() => { onSelect(person.id); Keyboard.dismiss(); }}
          style={({ pressed }) => [styles.result, { backgroundColor: pressed || selectedId === person.id ? colors.accentSoft : "transparent" }]}>
          <Text style={[styles.resultText, { color: colors.textPrimary }]}>{person.emoji ? `${person.emoji} ` : ""}{person.displayName}</Text>
        </Pressable>)}
        {matches.length === 0 ? <Text style={[styles.resultText, styles.result, { color: colors.textSecondary }]}>Никто не найден</Text> : null}
      </ScrollView>
    </View> : null}
  </View>;
}

function creditLine(info: CalendarBookingCredit | null, existing: CalendarAppointmentCredit): string | null {
  if (existing === "RESERVED") return "Тренировка зарезервирована из пакета клиента.";
  if (existing === "USED") return "Тренировка уже списана.";
  if (existing === "RETURNED") return "Списание по записи компенсировано возвратом.";
  if (info === null || info.kind === "NOT_REQUIRED") return null;
  if (info.kind === "NOT_TRACKED") return "Учёт занятий для клиента ведётся вне приложения или не ведётся.";
  if (info.kind === "AVAILABLE") return `${info.preferredPackTitle === undefined ? "" : `Пакет «${info.preferredPackTitle}»: `}Доступно тренировок: ${info.available} · будет зарезервирована 1.`;
  if (info.kind === "PREFERRED_UNAVAILABLE") return "Основной пакет закончился, истёк или не подходит для этого занятия. Выберите другой в «Абонементе и оплате» или запишите без списания.";
  return "Нет доступных тренировок. Добавьте пакет в карточке клиента или запишите без списания.";
}

/**
 * §13.7 + §22.1.4: one editor for create and edit. Delete has no generic confirmation; a
 * credit-linked appointment asks only for the settlement (return or charge).
 */
export function AppointmentEditorScreen({ repository, participants, credit, appointmentId, localDate, durationMinutes,
  startMinute, onClose, onCreateClientFromGuest }: Readonly<{
  repository: CalendarRepositoryPort;
  participants: CalendarParticipantDirectoryPort;
  credit: CalendarCreditPort;
  appointmentId?: string;
  localDate: LocalDate;
  startMinute?: number;
  /** A long-press range from the timeline; otherwise the session type default. */
  durationMinutes?: number;
  onClose: () => void;
  /** Opens the client form prefilled with the guest name; the shell links the records after save. */
  onCreateClientFromGuest?: (request: GuestLinkRequest) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [date, setDate] = useState(localDate);
  const [start, setStart] = useState<number | null>(startMinute ?? null);
  const [duration, setDuration] = useState<number | null>(null);
  const [guestMode, setGuestMode] = useState(false);
  const [clientId, setClientId] = useState<string | null>(null);
  const [guestName, setGuestName] = useState("");
  const [query, setQuery] = useState("");
  const [typeId, setTypeId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [creditInfo, setCreditInfo] = useState<CalendarBookingCredit | null>(null);
  const [existingCredit, setExistingCredit] = useState<CalendarAppointmentCredit>("NONE");
  const [settling, setSettling] = useState(false);
  const offerUndo = useOfferCancelUndo();
  const [sameGuest, setSameGuest] = useState(0);
  const [includeSameGuest, setIncludeSameGuest] = useState(true);
  const [linking, setLinking] = useState(false);
  const [linkId, setLinkId] = useState<string | null>(null);

  useEffect(() => {
    if (!appointmentId) return;
    let active = true;
    void Promise.resolve().then(() => repository.countSameGuest(appointmentId)).then((count) => {
      if (active) setSameGuest(count);
    },
      () => undefined);
    return () => { active = false; };
  }, [appointmentId, repository]);

  useEffect(() => {
    if (!appointmentId) return;
    let active = true;
    void credit.appointmentCredit(appointmentId).then((state) => { if (active) setExistingCredit(state); },
      () => undefined);
    return () => { active = false; };
  }, [appointmentId, credit]);

  const requiresCredit = loaded?.types.find((type) => type.id === typeId)?.requiresCredit ?? false;
  useEffect(() => {
    setCreditInfo(null);
    if (guestMode || clientId === null || typeId === null) return;
    let active = true;
    void credit.bookingContext(clientId, typeId, requiresCredit).then((info) => {
      if (active) setCreditInfo(info);
    }, () => undefined);
    return () => { active = false; };
  }, [clientId, credit, guestMode, requiresCredit, typeId]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      repository.getSettings(), repository.listSessionTypes(), participants.listParticipants(),
      appointmentId ? repository.getAppointment(appointmentId) : Promise.resolve(null),
      repository.listRange(localDate, localDate),
    ]).then(([settings, types, people, existing, day]) => {
      if (!active) return;
      const defaultType = types.find((type) => type.id === settings.defaultSessionTypeId && !type.archived)
        ?? types.find((type) => !type.archived);
      const minutes = defaultType?.defaultDurationMinutes ?? 60;
      let firstFree = settings.dayStartMinute;
      const busy = [
        ...day.appointments.map((row) => [row.startMinute, row.startMinute + row.durationMinutes] as const),
        ...day.intervals.filter((row) => row.kind === "BLOCKED")
          .map((row) => [row.startMinute, row.endMinute] as const),
      ];
      while (firstFree + minutes <= settings.dayEndMinute
        && busy.some(([from, to]) => overlaps(firstFree, firstFree + minutes, from, to))) {
        firstFree += SLOT_MINUTES;
      }
      setLoaded({ settings, types, people, existing, firstFree });
      if (existing !== null) {
        setDate(existing.localDate);
        setStart(existing.startMinute);
        setDuration(existing.durationMinutes);
        setClientId(existing.clientId);
        setGuestMode(existing.clientId === null);
        setGuestName(existing.guestName ?? "");
        setQuery(existing.guestName ?? "");
        setTypeId(existing.sessionTypeId);
        setNote(existing.note ?? "");
        setBypass(existing.creditBypass);
      } else {
        setStart((current) => current ?? Math.min(firstFree, settings.dayEndMinute - minutes));
        setDuration(durationMinutes ?? minutes);
        setTypeId(defaultType?.id ?? null);
      }
    }, () => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [appointmentId, localDate, participants, repository]);

  const existing = loaded?.existing ?? null;
  const now = new Date();
  // Прошедшая запись правится так же, как будущая; к ней добавляется блок исхода. Смена клиента у неё идёт
  // через «исправление» с компенсацией списания (§22.1.4), остальное — обычная правка без изменения учёта.
  const editable = existing === null || existing.lifecycle !== "CANCELLED";
  const outcomeOpen = existing !== null && existing.lifecycle !== "CANCELLED" && appointmentStarted(existing, now);
  const guestRecord = existing !== null && existing.guestName !== null && existing.lifecycle !== "CANCELLED"
    ? existing : null;
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return (loaded?.people ?? []).filter((person) => person.active
      && person.displayName.toLocaleLowerCase("ru").includes(needle)).slice(0, 8);
  }, [loaded, query]);
  const selectedPerson = clientId === null ? null : loaded?.people.find((person) => person.id === clientId) ?? null;

  if (loadFailed || (appointmentId !== undefined && loaded !== null && existing === null)) {
    return <PrototypeScreen>
      <InlineNotice kind="error">Запись не найдена или не загрузилась.</InlineNotice>
      <AppButton label="Вернуться в календарь" onPress={onClose} />
    </PrototypeScreen>;
  }
  if (loaded === null || start === null || duration === null) {
    return <PrototypeScreen><LoadingState label="Открываем запись…" /></PrototypeScreen>;
  }
  const settings = loaded.settings;
  const types = loaded.types.filter((type) => !type.archived || type.id === existing?.sessionTypeId);

  // Прошедшая запись: клиент меняется отдельной командой (компенсация списания или привязка гостя), затем время,
  // тип и заметка — обычным обновлением по свежей ревизии; без других изменений второй записи нет.
  const saveStarted = async (row: Appointment, input: AppointmentInput) => {
    let current = row;
    if (input.clientId !== null && input.clientId !== row.clientId) {
      if (row.clientId === null) await repository.linkGuestToClient(row.id, row.revision, input.clientId, false);
      else await repository.correctClient(row.id, row.revision, input.clientId);
      const fresh = await repository.getAppointment(row.id);
      if (fresh === null) throw new Error("CALENDAR_STALE_APPOINTMENT");
      current = fresh;
    }
    const same = current.localDate === input.localDate && current.startMinute === input.startMinute
      && current.durationMinutes === input.durationMinutes && current.sessionTypeId === input.sessionTypeId
      && (current.note ?? "") === (input.note ?? "").trim() && current.creditBypass === (input.creditBypass === true)
      && current.guestName === input.guestName;
    if (!same) await repository.updateAppointment(current.id, current.revision, input);
  };

  const save = async () => {
    if (busy || typeId === null) {
      if (typeId === null) setError(calendarErrorMessage(new Error("CALENDAR_SESSION_TYPE_REQUIRED")));
      return;
    }
    setBusy(true);
    setError(null);
    const input = { localDate: date, startMinute: start, durationMinutes: duration,
      clientId: guestMode ? null : clientId, guestName: guestMode ? guestName : null,
      sessionTypeId: typeId, note, creditBypass: !guestMode && bypass };
    try {
      if (existing === null) await repository.createAppointment(input);
      else if (outcomeOpen) await saveStarted(existing, input);
      else await repository.updateAppointment(existing.id, existing.revision, input);
      onClose();
    } catch (failure) {
      setError(calendarErrorMessage(failure));
      setBusy(false);
      // Клиент мог смениться до сбоя следующего шага: берём свежую запись, чтобы повтор не шёл со старой ревизией.
      if (existing !== null && outcomeOpen) {
        void repository.getAppointment(existing.id).then((fresh) => {
          if (fresh !== null) setLoaded((value) => value === null ? value : { ...value, existing: fresh });
        }, () => undefined);
      }
    }
  };

  const remove = async (settlement: CancelSettlement) => {
    if (busy || existing === null) return;
    setBusy(true);
    try {
      await repository.cancelAppointment(existing.id, existing.revision, settlement);
      onClose();
    } catch (failure) {
      setError(calendarErrorMessage(failure));
      setSettling(false);
      setBusy(false);
    }
  };
  const act = async (work: (row: Appointment) => Promise<unknown>) => {
    if (busy || existing === null) return;
    setBusy(true);
    setError(null);
    try {
      await work(existing);
      onClose();
    } catch (failure) {
      setError(calendarErrorMessage(failure));
      setBusy(false);
    }
  };
  const resolve = (outcome: AppointmentOutcome) => act(async (row) => {
    const after = await repository.resolveOutcome(row.id, row.revision, outcome);
    if (outcome !== "CANCELLED") return;
    const who = selectedPerson?.displayName ?? row.guestName ?? "Запись";
    offerUndo(row, after, `${who} · ${formatMinute(row.startMinute)} — отменено`);
  });
  const creditText = creditLine(guestMode ? null : creditInfo, existingCredit);
  const tag = existing === null ? null : outcomeTag(existing, now);

  return (
    <View style={styles.editor}>
    <PrototypeScreen compact>
      {!editable ? <InlineNotice kind="info">Запись отменена: время, тип и участник не меняются.</InlineNotice> : null}
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <SectionHeading>Участник</SectionHeading>
        {selectedPerson !== null ? (
          <Text style={[styles.selected, { color: colors.textPrimary }]}>
            {selectedPerson.emoji ? `${selectedPerson.emoji} ` : ""}{selectedPerson.displayName}
            {selectedPerson.active ? "" : " (в архиве)"}
          </Text>
        ) : existing?.participantDeleted ? (
          <Text style={[styles.selected, { color: colors.textSecondary }]}>Удалённый клиент</Text>
        ) : null}
        {editable ? <>
          <ParticipantSearch label="Имя участника записи" query={query} onQuery={(value) => {
            setQuery(value); setGuestName(value); setGuestMode(true); setClientId(null);
          }} matches={matches} selectedId={clientId} onSelect={(id) => {
            setClientId(id); setGuestMode(false); setGuestName(""); setQuery("");
          }} disabled={busy} />
        </> : null}
      {!editable && guestMode && guestName !== "" ? <Text style={[styles.selected, { color: colors.textPrimary }]}>{guestName}</Text> : null}
      {creditText !== null && !bypass ? (
        <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: colors.textSecondary }]}>
          {creditText}
        </Text>
      ) : null}
      {!guestMode && clientId !== null && requiresCredit && editable && existingCredit !== "USED" ? (
        <View style={styles.chips}>
          <SelectionChip compact fill group="Учёт" label="Записать без списания" selected={bypass} disabled={busy}
            onPress={() => setBypass(!bypass)} />
        </View>
      ) : null}
      </View>
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.stepper}>
        <AppButton compact size="small" variant="ghost" label="‹" accessibilityLabel="Предыдущий день" disabled={!editable || busy}
          onPress={() => setDate(addDays(date, -1))} />
        <Text style={[styles.stepperValue, { color: colors.textPrimary }]}>{dayTitle(date)}</Text>
        <AppButton compact size="small" variant="ghost" label="›" accessibilityLabel="Следующий день" disabled={!editable || busy}
          onPress={() => setDate(addDays(date, 1))} />
      </View>
      <View style={styles.stepper}>
        <AppButton compact size="small" variant="secondary" label="−30" accessibilityLabel="Начало на 30 минут раньше"
          disabled={!editable || busy || start - SLOT_MINUTES < settings.dayStartMinute}
          onPress={() => setStart(start - SLOT_MINUTES)} />
        <Text accessibilityLiveRegion="polite" style={[styles.stepperValue, { color: colors.textPrimary }]}>
          {formatMinute(start)}–{formatMinute(start + duration)}
        </Text>
        <AppButton compact size="small" variant="secondary" label="+30" accessibilityLabel="Начало на 30 минут позже"
          disabled={!editable || busy || start + SLOT_MINUTES + duration > settings.dayEndMinute}
          onPress={() => setStart(start + SLOT_MINUTES)} />
      </View>
      <ChoiceSegments label="Длительность" value={String(duration)} disabled={!editable || busy}
        items={[...new Set([...APPOINTMENT_DURATIONS, duration])].sort((a, b) => a - b)
          .map((minutes) => ({ id: String(minutes), label: `${minutes} мин` }))}
        onChange={(minutes) => setDuration(Number(minutes))} />
      </View>
      <View style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <SectionHeading>Тип занятия</SectionHeading>
      {Array.from({ length: Math.ceil(types.length / 2) }, (_, row) => <View key={row} style={styles.row}>
        {types.slice(row * 2, row * 2 + 2).map((type) => (
          <SelectionChip compact fill key={type.id} group="Тип занятия" label={type.name}
            selected={typeId === type.id} disabled={!editable || busy}
            onPress={() => {
              setTypeId(type.id);
              if (existing === null) setDuration(type.defaultDurationMinutes);
            }} />
        ))}
      </View>)}
      <TextField compact label="Заметка" value={note} onChangeText={setNote} disabled={!editable || busy}
        placeholder="Необязательно" />
      </View>
      {outcomeOpen ? <>
        <SectionHeading>Исход занятия</SectionHeading>
        <View style={styles.chips}>
          {tag !== null ? <StatusTag kind={tag.kind} label={tag.label} /> : (
            <Text style={[styles.hint, { color: colors.textSecondary }]}>Занятие идёт — исход можно отметить сейчас.</Text>
          )}
        </View>
        <View style={styles.row}>
          {existing.outcome === null ? <>
            <View style={styles.cell}><AppButton compact size="small" label="Завершить" disabled={busy}
              onPress={() => { void resolve("COMPLETED"); }} /></View>
            <View style={styles.cell}><AppButton compact size="small" variant="secondary" label="Пропущена" disabled={busy}
              onPress={() => { void resolve("MISSED"); }} /></View>
          </> : <>
            <View style={styles.cell}><AppButton compact size="small" variant="secondary" disabled={busy}
              label={existing.outcome === "COMPLETED" ? "Отменить завершение" : "Отменить пропуск"}
              onPress={() => { void act((row) => repository.clearOutcome(row.id, row.revision)); }} /></View>
            <View style={styles.cell}><AppButton compact size="small" variant="secondary" disabled={busy}
              label={existing.outcome === "COMPLETED" ? "Отметить пропущенной" : "Отметить проведённой"}
              onPress={() => { void resolve(existing.outcome === "COMPLETED" ? "MISSED" : "COMPLETED"); }} /></View>
          </>}
          <View style={styles.cell}><AppButton compact size="small" variant="secondary" label="Отменена" disabled={busy}
            onPress={() => { void resolve("CANCELLED"); }} /></View>
        </View>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Списание по времени не подтверждает проведение. «Отменена» уберёт запись из календаря
          {existingCredit === "USED" || existingCredit === "RESERVED" ? " и вернёт тренировку клиенту" : ""}.
        </Text>
      </> : null}
      {outcomeOpen && existing.clientId !== null && existingCredit !== "NONE" ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Смена клиента вернёт тренировку прежнему и спишет у выбранного, если их учёт ведётся в приложении.
        </Text>
      ) : null}
      {guestRecord !== null && guestRecord.guestName !== null ? <>
        <SectionHeading>Гость без карточки</SectionHeading>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Создайте карточку клиента или привяжите запись к существующей. Прошлые гостевые визиты не списываются.
        </Text>
        {sameGuest > 0 ? (
          <View style={styles.chips}>
            <SelectionChip group="Гость" selected={includeSameGuest}
              label={`Также другие записи «${guestRecord.guestName}»: ${sameGuest}`}
              onPress={() => setIncludeSameGuest(!includeSameGuest)} />
          </View>
        ) : null}
        {onCreateClientFromGuest !== undefined && !linking ? (
          <AppButton label="Создать карточку клиента" disabled={busy} onPress={() => {
            const request = { appointmentId: guestRecord.id, guestName: guestRecord.guestName ?? "",
              includeSameName: includeSameGuest && sameGuest > 0 };
            onClose();
            onCreateClientFromGuest(request);
          }} />
        ) : null}
        {!linking ? (
          <AppButton variant="secondary" label="Привязать к клиенту" disabled={busy} onPress={() => setLinking(true)} />
        ) : <>
          <ParticipantSearch label="Поиск клиента для привязки" query={query} onQuery={setQuery}
            matches={matches} selectedId={linkId} onSelect={(id) => { setLinkId(id); setQuery(""); }} disabled={busy} />
          {linkId !== null ? <Text style={[styles.selected, { color: colors.textPrimary }]}>{loaded.people.find((person) => person.id === linkId)?.displayName}</Text> : null}
          <AppButton label="Привязать" busy={busy} disabled={linkId === null} onPress={() => {
            if (linkId !== null) {
              void act((row) => repository.linkGuestToClient(row.id, row.revision, linkId,
                includeSameGuest && sameGuest > 0));
            }
          }} />
          <AppButton variant="ghost" label="Не привязывать" disabled={busy}
            onPress={() => { setLinking(false); setLinkId(null); }} />
        </>}
      </> : null}
    </PrototypeScreen>
    <View style={[styles.footer, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      <View style={styles.row}>
      {existing !== null && editable && !outcomeOpen ? (
        <View style={styles.cell}><AppButton compact size="small" variant="destructive" label="Удалить" disabled={busy}
          onPress={() => {
            if (existingCredit === "RESERVED" || existingCredit === "USED") setSettling(true);
            else void remove("RETURN");
          }} /></View>
      ) : null}
      <View style={styles.cell}><AppButton compact size="small" variant="secondary" label={editable ? "Отмена" : "Закрыть"} disabled={busy} onPress={onClose} /></View>
      {editable ? <View style={styles.cell}><AppButton compact size="small" label={existing === null ? "Записать" : "Сохранить"} busy={busy}
        onPress={() => { void save(); }} /></View> : null}
      </View>
    </View>
      <ConfirmDialog visible={settling} confirmBusy={busy} title="Удалить запись"
        description={existingCredit === "USED"
          ? "Тренировка по этой записи уже списана. Вернуть её клиенту или оставить списанной?"
          : "Тренировка зарезервирована из пакета клиента. Вернуть её клиенту или списать?"}
        confirmLabel="Вернуть тренировку клиенту" tertiaryLabel="Списать тренировку"
        onConfirm={() => { void remove("RETURN"); }} onTertiary={() => { void remove("CHARGE"); }}
        onCancel={() => setSettling(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  editor: { flex: 1 },
  section: { borderWidth: 1, borderRadius: 16, padding: 10, gap: 7 },
  row: { flexDirection: "row", gap: 6, alignItems: "stretch" },
  cell: { flex: 1, minWidth: 0 },
  footer: { borderTopWidth: 1, padding: 10, gap: 6 },
  search: { gap: 4 },
  results: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  resultScroll: { maxHeight: 176 },
  result: { minHeight: 44, paddingHorizontal: 10, paddingVertical: 8, justifyContent: "center" },
  resultText: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 6 },
  stepperValue: { flex: 1, textAlign: "center", fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  selected: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
