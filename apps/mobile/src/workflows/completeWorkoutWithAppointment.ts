import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { AppointmentOutcomeParticipant } from "../features/calendar/public.ts";
import type { CalendarOutcomeEffect, WorkoutOutcomeParticipant, WorkoutOutcomePort } from "../features/training/execution/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

/**
 * «Завершить тренировку» отмечает запись календаря «Проведена» (ADR-048, решение владельца 2026-10-28; пересмотр §48.31.2 п. 3, 7).
 * Правило одно и явное: тренировка с сегодняшней датой, запись того же клиента на сегодня без исхода, уже началась (при нескольких —
 * с самым поздним началом). Импорт с прошлой датой или без даты календарь не трогает. «Отменить завершение» снимает исход только
 * той записи, которую отметила эта тренировка, и только если он всё ещё «Проведена». «Пропущена» и «Отменена» календарь не трогают.
 * Исход тренировки и запись календаря пишутся одной транзакцией; уведомления — после commit.
 */
export function createWorkoutOutcomeWorkflow(transaction: TrainingTransaction, execution: WorkoutOutcomeParticipant<SqliteStatementPort>,
  calendar: AppointmentOutcomeParticipant<SqliteStatementPort>, now: () => Date = () => new Date()): WorkoutOutcomePort {
  return {
    setOutcome: async (slot, outcome, expectedRevision, at = now()) => {
      let effect: CalendarOutcomeEffect | null = null;
      let date: string | null = null;
      const result = await transaction(async (tx) => {
        const { session, previous } = await execution.setOutcome(tx, slot, outcome, expectedRevision, at);
        // Повторное «Завершена» (через порт) не ищет запись заново: прежняя связь остаётся у отмеченной записи.
        if (outcome === "COMPLETED" && previous !== "COMPLETED") {
          const today = execution.dayOf(at);
          const found = session.actualDate === today ? await calendar.findStartedPending(tx, slot.clientId, today, at) : null;
          if (found !== null) {
            await calendar.complete(tx, found, at);
            await execution.setAppointmentLink(tx, slot, found.id);
            effect = { kind: "MARKED", startMinute: found.startMinute };
            date = today;
          }
        } else if (previous === "COMPLETED" && outcome !== "COMPLETED") {
          const linked = await execution.appointmentLink(tx, slot);
          if (linked !== null) {
            const cleared = await calendar.clearIfCompleted(tx, linked, at);
            await execution.setAppointmentLink(tx, slot, null);
            if (cleared !== null) {
              effect = { kind: "CLEARED", startMinute: cleared.startMinute };
              date = cleared.localDate;
            }
          }
        }
        return session;
      });
      execution.notify(slot);
      if (date !== null) calendar.notify([date]);
      return { session: result, calendar: effect };
    },
  };
}
