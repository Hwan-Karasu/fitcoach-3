import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { ClientCardParticipant, ClientRecord, CreateClientInput } from "../features/clients/public.ts";
import type { AnswersParticipant, AnswerValue, ClientAnswers } from "../features/questionnaire/public.ts";
import type { TrainingTransaction } from "./copyTrainingWeek.ts";

export interface ClientCardWithAnswersPort {
  /**
   * Карточка клиента (Clients) и ответы анкеты (Questionnaire) одной транзакцией: либо оба, либо ничего.
   * `existing` — карточка и её revision при правке, `null` — создать нового клиента. Уведомления — после коммита.
   * `answers` результата — сохранённые ответы клиента, `null`, если изменённых ответов не было. Ошибки владельцев пробрасываются как есть (CLIENT_*, QUESTIONNAIRE_ANSWER_INVALID).
   */
  save(existing: Readonly<{ id: string; revision: number }> | null, input: CreateClientInput,
    answers: Readonly<Record<string, AnswerValue | null>>): Promise<Readonly<{ client: ClientRecord; answers: ClientAnswers | null }>>;
}

/** Ответы анкеты ссылаются на клиента, поэтому новая карточка без ответов (или ответы без карточки) не должны переживать сбой друг друга. */
export function createClientCardWorkflow(transaction: TrainingTransaction, card: ClientCardParticipant<SqliteStatementPort>,
  answers: AnswersParticipant<SqliteStatementPort>): ClientCardWithAnswersPort {
  return {
    save: async (existing, input, patch) => {
      const hasAnswers = Object.keys(patch).length > 0;
      const result = await transaction(async (tx) => {
        const client = existing === null ? await card.create(tx, input) : await card.update(tx, existing.id, existing.revision, input);
        return { client, answers: hasAnswers ? await answers.save(tx, client.id, patch) : null };
      });
      card.notify(result.client.id);
      if (hasAnswers) answers.notify(result.client.id);
      return result;
    },
  };
}
