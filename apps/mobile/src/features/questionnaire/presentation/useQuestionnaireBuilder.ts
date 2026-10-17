import { useCallback, useEffect, useRef, useState } from "react";
import type { PublishedQuestionnaire, PublishSummary, QuestionnaireDraft, QuestionnaireSchema } from "../domain/QuestionnaireModel.ts";
import type { QuestionnaireRepositoryPort } from "../domain/QuestionnaireRepositoryPort.ts";
import { validateSchema, type SchemaIssue } from "../domain/QuestionnaireRules.ts";

export type SaveState = "idle" | "pending" | "saved" | "failed";

const AUTOSAVE_MS = 600;
/** Набор текста в одном поле в пределах этого окна — один шаг отмены. */
const MERGE_MS = 1500;
const HISTORY_LIMIT = 50;

export function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : "UNKNOWN";
}

/** Новый стабильный ID для своего поля, раздела или варианта: не совпадает с прежними (§23.15). */
export function newBuilderId(): string {
  return `c:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Состояние конструктора анкеты (§§25, 27): один черновик, отмена/повтор, автосохранение с CAS
 * по revision (сохранения идут по очереди, позднее не затирает раннее), публикация версий.
 */
export function useQuestionnaireBuilder(repository: QuestionnaireRepositoryPort) {
  const [published, setPublished] = useState<PublishedQuestionnaire | null>(null);
  const [schema, setSchema] = useState<QuestionnaireSchema | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loadFailed, setLoadFailed] = useState(false);
  /** Черновик изменился в другом месте: показан сохранённый, правки последних секунд потеряны. */
  const [reloaded, setReloaded] = useState(false);
  const latest = useRef<QuestionnaireSchema | null>(null);
  const saved = useRef<QuestionnaireSchema | null>(null);
  const revision = useRef(0);
  const past = useRef<QuestionnaireSchema[]>([]);
  const future = useRef<QuestionnaireSchema[]>([]);
  const lastMerge = useRef<Readonly<{ key: string; at: number }> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const adopt = useCallback((draft: QuestionnaireDraft) => {
    revision.current = draft.revision;
    saved.current = draft.schema;
    latest.current = draft.schema;
    past.current = [];
    future.current = [];
    lastMerge.current = null;
    setBaseVersion(draft.baseVersion);
    setSchema(draft.schema);
    setSaveState("idle");
  }, []);

  const persist = useCallback(async () => {
    const target = latest.current;
    if (target === null || target === saved.current) return;
    try {
      const draft = await repository.saveDraft(revision.current, target);
      revision.current = draft.revision;
      saved.current = target;
      setSaveState(latest.current === target ? "saved" : "pending");
    } catch (error) {
      if (errorCode(error) !== "QUESTIONNAIRE_DRAFT_STALE") { setSaveState("failed"); return; }
      try {
        adopt(await repository.getDraft());
        setReloaded(true);
      } catch {
        setSaveState("failed");
      }
    }
  }, [adopt, repository]);

  /** Сохранить сейчас (после всех начатых сохранений). Не бросает: итог — в `saveState`. */
  const flush = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
    queue.current = queue.current.then(persist);
    return queue.current;
  }, [persist]);

  const schedule = useCallback(() => {
    setSaveState("pending");
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void flush(); }, AUTOSAVE_MS);
  }, [flush]);

  const load = useCallback(async () => {
    setLoadFailed(false);
    try {
      const [current, draft] = await Promise.all([repository.getPublished(), repository.getDraft()]);
      setPublished(current);
      adopt(draft);
    } catch {
      setLoadFailed(true);
    }
  }, [adopt, repository]);

  useEffect(() => { void load(); }, [load]);

  // Уход с экрана не теряет последние правки: отложенное сохранение выполняется сразу.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => { if (timer.current !== null) void flushRef.current(); }, []);

  /** Правка черновика. `mergeKey` склеивает частые правки одного поля в один шаг отмены. */
  const apply = useCallback((change: (current: QuestionnaireSchema) => QuestionnaireSchema, mergeKey?: string) => {
    const current = latest.current;
    if (current === null) return;
    const next = change(current);
    if (next === current) return;
    const now = Date.now();
    const merge = mergeKey !== undefined && lastMerge.current?.key === mergeKey && now - lastMerge.current.at < MERGE_MS;
    lastMerge.current = mergeKey === undefined ? null : { key: mergeKey, at: now };
    if (!merge) past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), current];
    future.current = [];
    latest.current = next;
    setSchema(next);
    setReloaded(false);
    schedule();
  }, [schedule]);

  const step = useCallback((from: typeof past, to: typeof future) => {
    const target = from.current.at(-1);
    const current = latest.current;
    if (target === undefined || current === null) return;
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, current];
    lastMerge.current = null;
    latest.current = target;
    setSchema(target);
    schedule();
  }, [schedule]);
  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);

  /** §27.12: сохранить, проверить схему, получить сводку изменений для подтверждения. */
  const preparePublish = useCallback(async (): Promise<
    Readonly<{ kind: "ISSUES"; issues: readonly SchemaIssue[] }> | Readonly<{ kind: "SUMMARY"; summary: PublishSummary }>
    | Readonly<{ kind: "UNSAVED" }>> => {
    await flush();
    if (latest.current === null || latest.current !== saved.current) return { kind: "UNSAVED" };
    const issues = validateSchema(latest.current);
    if (issues.length > 0) return { kind: "ISSUES", issues };
    return { kind: "SUMMARY", summary: await repository.previewPublish() };
  }, [flush, repository]);

  const publish = useCallback(async () => {
    const version = await repository.publishDraft(revision.current);
    setPublished(version);
    adopt(await repository.getDraft());
    return version;
  }, [adopt, repository]);

  /** Заменить черновик: опубликованная структура, историческая версия или стандартная анкета. */
  const replaceDraft = useCallback(async (source: number | "DEFAULT" | "PUBLISHED") => {
    await flush();
    adopt(source === "PUBLISHED" ? await repository.discardDraft() : await repository.draftFromVersion(source));
  }, [adopt, flush, repository]);

  return {
    published, schema, baseVersion, saveState, loadFailed, reloaded,
    canUndo: past.current.length > 0, canRedo: future.current.length > 0,
    load, apply, undo, redo, flush, preparePublish, publish, replaceDraft,
    listVersions: () => repository.listVersions(),
  };
}

export type QuestionnaireBuilder = ReturnType<typeof useQuestionnaireBuilder>;
