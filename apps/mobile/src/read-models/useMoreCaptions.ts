import { useEffect, useState } from "react";
import { plural } from "../shared/format/clockText.ts";
import { completionPercent, type QuestionnaireRepositoryPort } from "../features/questionnaire/public.ts";
import { historyCaption, questionnaireCaption, statisticsCaption } from "./moreCaptions.ts";
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

/** Подпись «Конструктор анкеты» в настройках: «Версия N · M разделов» по текущей опубликованной анкете (UIX-13). */
export function useQuestionnaireStructureCaption(repository: QuestionnaireRepositoryPort): string | null {
  const [caption, setCaption] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void repository.getPublished().then((published) => {
      if (!active) return;
      const sections = published.schema.sections.length;
      setCaption(`Версия ${published.version} · ${sections} ${plural(sections, "раздел", "раздела", "разделов")}`);
    }, () => undefined);
    return () => { active = false; };
  }, [repository, tick]);
  useEffect(() => repository.subscribeCommittedChanges((change) => { if (change.scope === "SCHEMA") setTick((value) => value + 1); }), [repository]);
  return caption;
}

/** Подпись карточки «Статистика»: «Ноябрь: N занятий» (UIX-10/11); день берётся при каждом перечитывании. */
export function useStatisticsCaption(clientId: string, history: TrainingHistoryPort, todayOf: () => string): string | null {
  const [state, setState] = useState<Readonly<{ clientId: string; caption: string }> | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    void history.list(clientId).then((entries) => { if (active) setState({ clientId, caption: statisticsCaption(entries, todayOf()) }); }, () => undefined);
    return () => { active = false; };
  }, [history, clientId, tick, todayOf]);
  useEffect(() => history.subscribe(clientId, () => setTick((value) => value + 1)), [history, clientId]);
  return state !== null && state.clientId === clientId ? state.caption : null;
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
