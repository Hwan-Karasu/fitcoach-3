import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, LoadingState, SearchField, SelectionChip,
  TextField } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { APPOINTMENT_DURATIONS, SLOT_MINUTES, type Appointment, type CalendarSettings, type LocalDate,
  type SessionType } from "../domain/CalendarModel.ts";
import type { CalendarParticipant, CalendarParticipantDirectoryPort } from
  "../domain/CalendarParticipantDirectoryPort.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { addDays, formatMinute, overlaps } from "../domain/CalendarRules.ts";
import { calendarErrorMessage, dayTitle } from "./calendarPresentation.ts";

interface Loaded {
  readonly settings: CalendarSettings;
  readonly types: readonly SessionType[];
  readonly people: readonly CalendarParticipant[];
  readonly existing: Appointment | null;
  readonly firstFree: number;
}

/** §13.7: one editor for create and edit; delete has no generic confirmation (no credits yet). */
export function AppointmentEditorScreen({ repository, participants, appointmentId, localDate,
  startMinute, onClose }: Readonly<{
  repository: CalendarRepositoryPort;
  participants: CalendarParticipantDirectoryPort;
  appointmentId?: string;
  localDate: LocalDate;
  startMinute?: number;
  onClose: () => void;
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
        setTypeId(existing.sessionTypeId);
        setNote(existing.note ?? "");
      } else {
        setStart((current) => current ?? Math.min(firstFree, settings.dayEndMinute - minutes));
        setDuration(minutes);
        setTypeId(defaultType?.id ?? null);
      }
    }, () => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [appointmentId, localDate, participants, repository]);

  const existing = loaded?.existing ?? null;
  const editable = existing === null || existing.lifecycle === "SCHEDULED";
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

  const save = async () => {
    if (busy || typeId === null) {
      if (typeId === null) setError(calendarErrorMessage(new Error("CALENDAR_SESSION_TYPE_REQUIRED")));
      return;
    }
    setBusy(true);
    setError(null);
    const input = { localDate: date, startMinute: start, durationMinutes: duration,
      clientId: guestMode ? null : clientId, guestName: guestMode ? guestName : null,
      sessionTypeId: typeId, note };
    try {
      if (existing === null) await repository.createAppointment(input);
      else await repository.updateAppointment(existing.id, existing.revision, input);
      onClose();
    } catch (failure) {
      setError(calendarErrorMessage(failure));
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy || existing === null) return;
    setBusy(true);
    try {
      await repository.cancelAppointment(existing.id, existing.revision);
      onClose();
    } catch (failure) {
      setError(calendarErrorMessage(failure));
      setBusy(false);
    }
  };

  return (
    <PrototypeScreen>
      {!editable ? <InlineNotice kind="info">
        Проведённая запись не редактируется как будущая. Исправление клиента появится вместе с учётом занятий.
      </InlineNotice> : null}
      <View style={styles.stepper}>
        <AppButton variant="ghost" label="‹" accessibilityLabel="Предыдущий день" disabled={!editable}
          onPress={() => setDate(addDays(date, -1))} />
        <Text style={[styles.stepperValue, { color: colors.textPrimary }]}>{dayTitle(date)}</Text>
        <AppButton variant="ghost" label="›" accessibilityLabel="Следующий день" disabled={!editable}
          onPress={() => setDate(addDays(date, 1))} />
      </View>
      <View style={styles.stepper}>
        <AppButton variant="secondary" label="−30" accessibilityLabel="Начало на 30 минут раньше"
          disabled={!editable || start - SLOT_MINUTES < settings.dayStartMinute}
          onPress={() => setStart(start - SLOT_MINUTES)} />
        <Text accessibilityLiveRegion="polite" style={[styles.stepperValue, { color: colors.textPrimary }]}>
          {formatMinute(start)}–{formatMinute(start + duration)}
        </Text>
        <AppButton variant="secondary" label="+30" accessibilityLabel="Начало на 30 минут позже"
          disabled={!editable || start + SLOT_MINUTES + duration > settings.dayEndMinute}
          onPress={() => setStart(start + SLOT_MINUTES)} />
      </View>
      <SectionHeading>Длительность</SectionHeading>
      <View style={styles.chips}>
        {[...new Set([...APPOINTMENT_DURATIONS, duration])].sort((a, b) => a - b).map((minutes) => (
          <SelectionChip key={minutes} group="Длительность" label={`${minutes} мин`}
            selected={duration === minutes} disabled={!editable}
            onPress={() => setDuration(minutes)} />
        ))}
      </View>
      <SectionHeading>Участник</SectionHeading>
      <View style={styles.chips}>
        <SelectionChip group="Участник" label="Клиент" selected={!guestMode} disabled={!editable}
          onPress={() => setGuestMode(false)} />
        <SelectionChip group="Участник" label="Гость" selected={guestMode} disabled={!editable}
          onPress={() => setGuestMode(true)} />
      </View>
      {guestMode ? (
        <TextField label="Имя гостя" value={guestName} onChangeText={setGuestName} required
          disabled={!editable} placeholder="Как подписать запись" />
      ) : <>
        {selectedPerson !== null ? (
          <Text style={[styles.selected, { color: colors.textPrimary }]}>
            {selectedPerson.emoji ? `${selectedPerson.emoji} ` : ""}{selectedPerson.displayName}
            {selectedPerson.active ? "" : " (в архиве)"}
          </Text>
        ) : existing?.participantDeleted ? (
          <Text style={[styles.selected, { color: colors.textSecondary }]}>Удалённый клиент</Text>
        ) : null}
        {editable ? <>
          <SearchField accessibilityLabel="Поиск клиента для записи" query={query} onChangeQuery={setQuery} />
          <View style={styles.chips}>
            {matches.map((person) => (
              <SelectionChip key={person.id} group="Клиент"
                label={`${person.emoji ? `${person.emoji} ` : ""}${person.displayName}`}
                selected={clientId === person.id} onPress={() => setClientId(person.id)} />
            ))}
          </View>
          {matches.length === 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>
            {loaded.people.some((person) => person.active) ? "Никто не найден." : "Активных клиентов пока нет — запишите гостя."}
          </Text> : null}
        </> : null}
      </>}
      <SectionHeading>Тип занятия</SectionHeading>
      <View style={styles.chips}>
        {types.map((type) => (
          <SelectionChip key={type.id} group="Тип занятия" label={type.name}
            selected={typeId === type.id} disabled={!editable}
            onPress={() => {
              setTypeId(type.id);
              if (existing === null) setDuration(type.defaultDurationMinutes);
            }} />
        ))}
      </View>
      <TextField label="Заметка" value={note} onChangeText={setNote} disabled={!editable}
        placeholder="Необязательно" />
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {editable ? <AppButton label={existing === null ? "Записать" : "Сохранить изменения"} busy={busy}
        onPress={() => { void save(); }} /> : null}
      {existing !== null && editable ? (
        <AppButton variant="destructive" label="Удалить запись" disabled={busy}
          onPress={() => { void remove(); }} />
      ) : null}
      <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={onClose} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  stepperValue: { flex: 1, textAlign: "center", fontSize: 17, lineHeight: 24, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  selected: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  hint: { fontSize: 12, lineHeight: 18 },
});
