import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { ClientBodyParticipant, ClientRecord } from "../features/clients/public.ts";
import type { CalcProfile, CalcProfileParticipant, StoredCalcProfile } from "../features/nutrition/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

export interface CalcProfileWithBodyPort {
  /**
   * Профиль расчёта (Nutrition) и пол/рост карточки клиента (Clients, `body: null` — не менять) одной транзакцией: либо оба, либо ничего.
   * Уведомления подписчикам — после коммита. Ошибки: CALC_PROFILE_INVALID, CALC_STALE, CLIENT_SEX_INVALID, CLIENT_HEIGHT_INVALID, CLIENT_STALE_OR_WRONG_SCOPE.
   */
  save(clientId: string, profile: CalcProfile, expectedRevision: number | null, body: Readonly<{ sex: "MALE" | "FEMALE" | null; heightCmX10: number | null }> | null):
    Promise<Readonly<{ stored: StoredCalcProfile; client: ClientRecord | null }>>;
}

/** Профиль расчёта зависит от пола и роста карточки, поэтому оба владельца пишут в одной транзакции (иначе расчёт мог бы идти по половине правки). */
export function createCalcProfileWorkflow(transaction: TrainingTransaction, calc: CalcProfileParticipant<SqliteStatementPort>,
  body: ClientBodyParticipant<SqliteStatementPort>, now: () => Date = () => new Date()): CalcProfileWithBodyPort {
  return {
    save: async (clientId, profile, expectedRevision, bodyPatch) => {
      const result = await transaction(async (tx) => {
        const stored = await calc.save(tx, clientId, profile, expectedRevision, now());
        const client = bodyPatch === null ? null : await body.update(tx, clientId, bodyPatch);
        return { stored, client };
      });
      calc.notify(clientId);
      if (result.client !== null) body.notify(clientId);
      return result;
    },
  };
}
