import { useEffect, useState } from "react";
import { completionPercent, type QuestionnaireRepositoryPort } from "../features/questionnaire/public.ts";
import { historyCaption, questionnaireCaption } from "./moreCaptions.ts";
import type { TrainingHistoryPort } from "./trainingHistory.ts";

/**
 * Подпись карточки «Анкета» во вкладке «Ещё»: «Заполнена на N %» по всем видимым вопросам текущей версии (UIX-10).
 * Пока данные читаются или чтение не удалось — `null` (карточка показывает обычное описание). Подписка снимается в cleanup.
 */
export function useQuestionnaireCaption(clientId: string, repository: QuestionnaireRepositoryPort): string | null {
  const [state, setState] = useState<Readonly<{ clientId: string; percent: number }> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void Promise.all([repository.getPublished(), repository.getAnswers(clientId)]).then(([published, saved]) => {
      if (active) setState({ clientId, percent: completionPercent(published.schema, saved.answers) });
    }, () => undefined);
    return () => { active = false; };
  }, [repository, clientId, tick]);
  useEffect(() => repository.subscribeCommittedChanges((change) => { if (change.clientId === null || change.clientId === clientId) setTick((value) => value + 1); }), [repository, clientId]);
  return questionnaireCaption(state !== null && state.clientId === clientId ? state.percent : null);
}

/** Подпись карточки «История занятий»: «N занятий, последнее дата» по завершённым занятиям (UIX-10). */
export function useHistoryCaption(clientId: string, history: TrainingHistoryPort): string | null {
  const [state, setState] = useState<Readonly<{ clientId: string; caption: string }> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void history.list(clientId).then((entries) => { if (active) setState({ clientId, caption: historyCaption(entries) }); }, () => undefined);
    return () => { active = false; };
  }, [history, clientId, tick]);
  useEffect(() => history.subscribe(clientId, () => setTick((value) => value + 1)), [history, clientId]);
  return state !== null && state.clientId === clientId ? state.caption : null;
}
