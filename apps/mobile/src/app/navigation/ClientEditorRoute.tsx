import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Activity, Apple, Flame, HeartPulse, ListPlus, Tag, Target, type LucideIcon } from "lucide-react-native";
import { ClientEditorPreview, type ClientEditorAppendix, type ClientRecord, type ClientRecoveryDraft,
  type ClientRecoveryDraftPort, type ClientRepositoryPort } from
  "../../features/clients/public.ts";
import { QuestionnaireForm, useAnswersForm, type AnswerValue,
  type QuestionnaireRepositoryPort } from "../../features/questionnaire/public.ts";
import { latestPoint, localDateOf, parseValueX10, upsertDailyMeasurement, type MeasurementRepositoryPort } from "../../features/measurements/public.ts";
import { AppButton, ConfirmDialog, LoadingState } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

/** Значки вкладок стандартных разделов анкеты; свои разделы тренера получают нейтральный значок. */
const sectionIcons: Readonly<Record<string, LucideIcon>> = {
  "sys:goals": Target, "sys:health": HeartPulse, "sys:lifestyle": Activity, "sys:nutrition": Apple, "sys:motivation": Flame, "sys:extra": ListPlus,
};

type Loaded = Readonly<{ client: ClientRecord | null; draft: ClientRecoveryDraft | null }>;

/**
 * Единая карточка клиента: основное (владелец Clients) и анкета (владелец Questionnaire) в одной форме
 * с одним сохранением — сначала карточка, затем ответы по её ID. Если ответы не сохранились, повторное
 * сохранение не создаёт второго клиента, а дописывает ответы к уже сохранённой карточке.
 */
export function ClientEditorRoute({ clientId, repository, questionnaire, measurements, onClose, prefillName, onCreated }: Readonly<{
  clientId?: string;
  /** A guest name from Calendar; an existing recovery draft still asks first. */
  prefillName?: string;
  /** Runs after a new card is saved; must not throw, the card already exists. */
  onCreated?: (client: ClientRecord) => Promise<void>;
  repository: ClientRepositoryPort & ClientRecoveryDraftPort;
  questionnaire: QuestionnaireRepositoryPort;
  /** Вес клиента — единый факт Measurements: показывается и записывается из карточки. */
  measurements: MeasurementRepositoryPort;
  onClose: () => void;
}>) {
  const answers = useAnswersForm(questionnaire, clientId ?? null);
  const patch = useRef<Readonly<Record<string, AnswerValue | null>>>({});
  /** Карточка, уже сохранённая в этой форме: повтор после сбоя ответов её обновляет, а не создаёт новую. */
  const savedClient = useRef<ClientRecord | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [initialWeight, setInitialWeight] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [choice, setChoice] = useState<"ask" | "use" | "fresh">("ask");
  const [discardBusy, setDiscardBusy] = useState(false);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;

  useEffect(() => {
    let active = true;
    setLoaded(null);
    setLoadFailed(false);
    setChoice("ask");
    void Promise.all([clientId === undefined ? Promise.resolve(null) : repository.get(clientId),
      repository.loadDraft(clientId ?? null)])
      .then(([client, draft]) => { if (active) setLoaded({ client, draft }); })
      .catch(() => { if (active) setLoadFailed(true); });
    // Последний вес из замеров (неоднозначное значение дня не показывается); сбой чтения веса карточку не блокирует.
    setInitialWeight(null);
    if (clientId !== undefined) {
      void measurements.listForClient(clientId).then((data) => {
        const point = latestPoint(data.measurements, data.primaries, "WEIGHT");
        if (active) setInitialWeight(point !== null && point.kind === "VALUE" ? String(point.measurement.valueX10 / 10).replace(".", ",") : "");
      }, () => { if (active) setInitialWeight(""); });
    }
    return () => { active = false; };
  }, [clientId, repository, measurements]);

  if ((loaded === null && !loadFailed) || (clientId !== undefined && initialWeight === null && !loadFailed)) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <LoadingState label="Открываем карточку…" />
    </View>;
  }
  if (loadFailed || (clientId !== undefined && loaded?.client === null)) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <Text style={{ color: colors.textPrimary }}>Карточка или её черновик недоступны. Данные не изменены.</Text>
      <AppButton label="Назад" onPress={onClose} />
    </View>;
  }
  if (loaded === null) return null;
  const client = loaded.client;
  const draft = loaded.draft;
  const editConflict = clientId !== undefined && draft !== null
    && draft.baseClientRevision !== client?.revision;

  if (editConflict) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>Черновик другой версии</Text>
      <Text style={{ color: colors.textSecondary }}>
        Карточка изменилась после сохранения черновика. Автоматически наложить старые значения небезопасно.
      </Text>
      <AppButton variant="secondary" label="Вернуться" onPress={onClose} />
      <AppButton variant="destructive" label="Удалить старый черновик и открыть"
        onPress={() => setDiscardConfirm(true)} />
      <ConfirmDialog visible={discardConfirm} confirmBusy={discardBusy}
        title="Удалить старый черновик?"
        description="Несохранённые значения черновика будут удалены. Сохранённая карточка останется без изменений."
        confirmLabel="Удалить черновик" destructive
        onCancel={() => setDiscardConfirm(false)}
        onConfirm={() => {
          setDiscardBusy(true);
          void repository.discardDraft(clientId ?? null)
            .then(() => { setLoaded({ client, draft: null }); setDiscardConfirm(false); })
            .catch(() => setDiscardConfirm(false))
            .finally(() => setDiscardBusy(false));
        }} />
    </View>;
  }

  if (clientId === undefined && draft !== null && choice === "ask") {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      <ConfirmDialog visible title="Продолжить черновик клиента?"
        description="Незавершённая форма сохранена на этом устройстве. Можно продолжить её или начать новую карточку."
        cancelLabel="Продолжить" confirmLabel="Начать заново" confirmBusy={discardBusy}
        onCancel={() => setChoice("use")}
        onConfirm={() => {
          setDiscardBusy(true);
          void repository.discardDraft(null)
            .then(() => { setLoaded({ client: null, draft: null }); setChoice("fresh"); })
            .catch(() => setLoadFailed(true))
            .finally(() => setDiscardBusy(false));
        }} />
    </View>;
  }

  const recovered = draft !== null && (clientId !== undefined || choice === "use");
  const published = answers.published;
  const appendix: ClientEditorAppendix | undefined = published === null ? undefined : {
    sections: published.schema.sections.filter((section) => !section.hidden)
      .map((section) => ({ id: section.id, title: section.title, icon: sectionIcons[section.id] ?? Tag })),
    dirty: answers.dirtyIds.length > 0,
    validate: () => {
      const prepared = answers.prepare();
      if (prepared === null) return false;
      patch.current = prepared;
      return true;
    },
    render: (onSectionLayout) => <QuestionnaireForm schema={published.schema} inputs={answers.inputs}
      errors={answers.errors} onChange={answers.onChange} onSectionLayout={onSectionLayout} />,
  };
  return <ClientEditorPreview key={`${clientId ?? "new"}:${recovered ? draft?.id : "fresh"}`}
    initial={client ?? undefined}
    initialWeight={initialWeight ?? ""}
    initialDraft={recovered ? draft?.formData : prefillName === undefined ? undefined
      : { displayName: prefillName, contactPhone: "", contactEmail: "", birthDate: "", heightDraft: "", emoji: null }}
    recoveredDraft={recovered}
    appendix={appendix}
    onClose={onClose}
    onSaveDraft={async (formData) => {
      await repository.saveDraft({ clientId: clientId ?? null,
        baseClientRevision: client?.revision ?? null, formData });
    }}
    onDiscardDraft={() => repository.discardDraft(clientId ?? null)}
    onSave={async (input, extras) => {
      const known = savedClient.current ?? client;
      if (known !== null) savedClient.current = await repository.update(known.id, known.revision, input);
      else {
        savedClient.current = await repository.create(input);
        await onCreated?.(savedClient.current);
      }
      try { await answers.commit(savedClient.current.id, patch.current); }
      catch { throw new Error("QUESTIONNAIRE_SAVE_FAILED"); }
      patch.current = {};
      // Вес из карточки — новый факт замеров за сегодня (или правка сегодняшнего), только если изменился.
      const weightText = extras.weightText.replace(",", ".");
      if (weightText !== "" && weightText !== (initialWeight ?? "").replace(",", ".")) {
        const valueX10 = parseValueX10(weightText);
        try {
          if (valueX10 === null) throw new Error("WEIGHT_SAVE_FAILED");
          await upsertDailyMeasurement(measurements, savedClient.current.id, { type: "WEIGHT", valueX10, localDate: localDateOf(new Date()), localMinute: null });
        } catch { throw new Error("WEIGHT_SAVE_FAILED"); }
      }
    }} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", padding: 24, gap: 16 },
  title: { fontSize: 18, lineHeight: 23, fontFamily: fonts.bold },
});
