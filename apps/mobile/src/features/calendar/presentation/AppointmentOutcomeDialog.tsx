import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { Appointment, AppointmentOutcome } from "../domain/CalendarModel.ts";
import type { CalendarAppointmentCredit, CalendarCreditPort } from "../domain/CalendarCreditPort.ts";
import type { CalendarParticipantDirectoryPort } from "../domain/CalendarParticipantDirectoryPort.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { appointmentLabel, formatMinute } from "../domain/CalendarRules.ts";
import { calendarErrorMessage, dayTitle, useParticipants } from "./calendarPresentation.ts";
import { CancelUndoHost, useOfferCancelUndo } from "./CancelUndo.tsx";

/** «Тренировка списана» only after a real USED; untracked and bypass rows get no finance text (§48.40.6). */
function creditText(row: Appointment, state: CalendarAppointmentCredit | null): string | null {
  if (row.creditBypass) return "Записано без списания — учёт тренировок не меняется.";
  if (state === "USED") return "Тренировка списана из пакета клиента.";
  if (state === "RESERVED") return "Тренировка будет списана из пакета клиента.";
  return null;
}

/**
 * §48.35/48.40: one modal card per ended appointment with ‹ N из M › navigation. «Позже» keeps
 * every record pending; only a saved outcome removes it from the queue.
 */
export function AppointmentOutcomeDialog({ items, visible, repository, participants, credit, onLater }: Readonly<{
  items: readonly Appointment[];
  visible: boolean;
  repository: CalendarRepositoryPort;
  participants: CalendarParticipantDirectoryPort;
  credit: CalendarCreditPort;
  onLater: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const people = useParticipants(participants);
  const offerUndo = useOfferCancelUndo();
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creditState, setCreditState] = useState<CalendarAppointmentCredit | null>(null);
  const position = Math.min(index, Math.max(items.length - 1, 0));
  const row = items[position] ?? null;

  useEffect(() => {
    setCreditState(null);
    setError(null);
    if (row === null) return;
    let active = true;
    void credit.appointmentCredit(row.id).then((state) => { if (active) setCreditState(state); }, () => undefined);
    return () => { active = false; };
  }, [credit, row]);

  if (row === null) return null;
  const person = row.clientId === null ? null : people.get(row.clientId) ?? null;
  const name = `${person?.emoji ? `${person.emoji} ` : ""}${appointmentLabel(row, person?.displayName ?? null)}`;
  const finance = creditText(row, creditState);

  const resolve = async (outcome: AppointmentOutcome) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const after = await repository.resolveOutcome(row.id, row.revision, outcome);
      if (outcome === "CANCELLED") offerUndo(row, after, `${name} · ${formatMinute(row.startMinute)} — отменено`);
    } catch (failure) {
      setError(calendarErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onLater(); }}>
      <View style={styles.overlay}>
        <Pressable accessible={false} importantForAccessibility="no" style={styles.scrim}
          onPress={() => { if (!busy) onLater(); }} />
        <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <ScrollView style={styles.copyScroll} contentContainerStyle={styles.copy}>
            <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>Занятие закончилось</Text>
            <Text style={[styles.name, { color: colors.textPrimary }]}>{name}</Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>
              {dayTitle(row.localDate)} · {formatMinute(row.startMinute)}–{formatMinute(row.startMinute + row.durationMinutes)}
            </Text>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>
              {row.sessionTypeName}{row.guestName !== null ? " · гость без карточки" : ""}
            </Text>
            {finance !== null ? <Text style={[styles.detail, { color: colors.textPrimary }]}>{finance}</Text> : null}
            <Text style={[styles.detail, { color: colors.textSecondary }]}>
              Отметьте, как прошло занятие. «Отменена» уберёт запись из календаря
              {creditState === "USED" || creditState === "RESERVED" ? " и вернёт тренировку клиенту" : ""}.
            </Text>
            {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
          </ScrollView>
          <View style={styles.actions}>
            <AppButton label="Завершить тренировку" busy={busy} onPress={() => { void resolve("COMPLETED"); }} />
            <AppButton variant="secondary" label="Пропущена" disabled={busy}
              disabledReason="Дождитесь завершения операции" onPress={() => { void resolve("MISSED"); }} />
            <AppButton variant="secondary" label="Отменена" disabled={busy}
              disabledReason="Дождитесь завершения операции" onPress={() => { void resolve("CANCELLED"); }} />
          </View>
          <View style={styles.pager}>
            <AppButton variant="ghost" label="‹" accessibilityLabel="Предыдущее занятие"
              disabled={busy || position === 0} onPress={() => setIndex(position - 1)} />
            <Text accessibilityLiveRegion="polite" style={[styles.counter, { color: colors.textSecondary }]}>
              {position + 1} из {items.length}
            </Text>
            <AppButton variant="ghost" label="›" accessibilityLabel="Следующее занятие"
              disabled={busy || position >= items.length - 1} onPress={() => setIndex(position + 1)} />
          </View>
          <AppButton variant="ghost" label="Позже" disabled={busy} onPress={onLater} />
        </View>
        <CancelUndoHost />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", padding: 20 },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.48)" },
  card: { maxHeight: "90%", width: "100%", borderWidth: 1, borderRadius: 16, padding: 20, gap: 8 },
  copyScroll: { flexGrow: 0, flexShrink: 1 },
  copy: { gap: 6 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: "700" },
  name: { fontSize: 17, lineHeight: 24, fontWeight: "700" },
  detail: { fontSize: 14, lineHeight: 20 },
  actions: { gap: 8, marginTop: 8 },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  counter: { flex: 1, textAlign: "center", fontSize: 14, lineHeight: 20 },
});
