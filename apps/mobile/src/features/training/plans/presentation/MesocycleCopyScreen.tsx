import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, LoadingState, SearchableSelect, SelectionChip, StickyEditorFooter, TextField,
  TrainingEditorLayout } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { TrainingProgram, ProgramCard } from "../domain/ProgramModel.ts";
import { weekTypeLabels, type PeriodizedPlan, type WeekType } from "../domain/PeriodizedModel.ts";
import type { PlannedWorkout } from "../domain/SimplePlanModel.ts";
import { templateKindLabels, type ProgramTemplate, type TemplateMesocycle } from "../domain/TemplateModel.ts";

/** §48.13.1 п. 2: два источника копии в одном мастере. */
type Source = "CLIENT" | "TEMPLATE";
import { PROGRAM_TITLE_MAX } from "../domain/ProgramRules.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { ParticipantChips } from "./ParticipantChips.tsx";

export function MesocycleCopyScreen({ clientId, programId, repository, listCandidates, onCreated, onCancel }: Readonly<{
  clientId: string; programId: string; repository: TrainingPlansRepositoryPort;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>; onCreated: () => void; onCancel: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [target, setTarget] = useState<TrainingProgram | null>(null);
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [selected, setSelected] = useState<readonly string[]>([clientId]);
  const [sourceClient, setSourceClient] = useState(clientId);
  const [sourceProgram, setSourceProgram] = useState(programId);
  const [sourceCycle, setSourceCycle] = useState("");
  const [programs, setPrograms] = useState<readonly ProgramCard[]>([]);
  const [plan, setPlan] = useState<PeriodizedPlan | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState<Source>("CLIENT");
  const [templates, setTemplates] = useState<readonly ProgramTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [templateCycle, setTemplateCycle] = useState("");
  useEffect(() => {
    let active = true;
    // Простой шаблон — не мезоцикл (§48.14.2 п. 4): предлагаются шаблоны мезоциклов и Расширенных программ.
    void repository.listTemplates().then((rows) => { if (active) setTemplates(rows.filter((item) => item.kind !== "SIMPLE")); })
      .catch(() => { if (active) setMessage("Не удалось загрузить шаблоны."); });
    return () => { active = false; };
  }, [repository, refresh]);
  useEffect(() => {
    let active = true;
    void Promise.all([repository.getProgram(clientId, programId), listCandidates()]).then(([program, candidates]) => {
      if (!active) return;
      setTarget(program);
      setNames(new Map(candidates.map((item) => [item.id, item.displayName])));
      if (!program) setMessage("Целевая программа не найдена.");
    }).catch(() => { if (active) setMessage("Не удалось загрузить программу и клиентов."); });
    return () => { active = false; };
  }, [repository, clientId, programId, listCandidates, refresh]);
  useEffect(() => {
    let active = true;
    setPrograms([]);
    void repository.getLibrary(sourceClient).then((library) => {
      if (active) setPrograms([...library.active, ...library.archived].filter((item) => item.kind === "PERIODIZED"));
    }).catch(() => { if (active) setMessage("Не удалось загрузить программы источника."); });
    return () => { active = false; };
  }, [repository, sourceClient, refresh]);
  useEffect(() => {
    let active = true;
    setPlan(null);
    setLoading(false);
    if (!sourceProgram) return;
    setLoading(true);
    void repository.getPeriodizedPlan(sourceClient, sourceProgram).then((value) => { if (active) setPlan(value); })
      .catch(() => { if (active) setMessage("Не удалось загрузить мезоциклы источника."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [repository, sourceClient, sourceProgram, refresh]);
  const cycle = plan?.mesocycles.find((item) => item.id === sourceCycle);
  const template = templates.find((item) => item.id === templateId);
  const templateCycles: readonly TemplateMesocycle[] = template === undefined ? []
    : template.payload.kind === "MESOCYCLE" ? [template.payload.mesocycle]
      : template.payload.kind === "PERIODIZED" ? template.payload.mesocycles : [];
  const chosenTemplateCycle = templateCycle === "" ? undefined : templateCycles[Number(templateCycle)];
  // Общий предпросмотр для обоих источников.
  const preview: Readonly<{ weeks: readonly Readonly<{ key: string; index: number; type: WeekType; workouts: readonly PlannedWorkout[] }>[] }> | null =
    source === "CLIENT" ? (cycle === undefined ? null : { weeks: cycle.weeks.map((week) => ({ key: week.id, index: week.index,
      type: week.type, workouts: week.workouts })) })
      : chosenTemplateCycle === undefined ? null : { weeks: chosenTemplateCycle.weeks.map((week, index) => ({ key: String(index),
        index: index + 1, type: week.type, workouts: week.workouts })) };
  const save = async () => {
    if (!target || preview === null || busy) return;
    setBusy(true); setMessage(null);
    try {
      if (source === "TEMPLATE") {
        await repository.createMesocycleFromTemplate(clientId, programId, target.revision, { templateId,
          mesocycleIndex: Number(templateCycle), title, clientIds: selected });
      } else {
        if (!plan || !cycle) return;
        await repository.copyMesocycle(clientId, programId, target.revision, { sourceClientId: sourceClient,
          sourceProgramId: sourceProgram, sourceMesocycleId: cycle.id, sourceRevision: plan.program.revision,
          title, clientIds: selected });
      }
      onCreated();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code.includes("REVISION_CONFLICT") ? "План изменился. Обновите предпросмотр перед копированием."
        : "Не удалось скопировать мезоцикл. Проверьте источник и участников, затем повторите.");
    } finally { setBusy(false); }
  };
  return <TrainingEditorLayout>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Источник плана</Text>
      <View style={styles.chips}>
        <SelectionChip group="Источник" label="Из программы клиента" selected={source === "CLIENT"}
          onPress={() => { setSource("CLIENT"); setTitle(""); }} />
        <SelectionChip group="Источник" label="Из сохранённых шаблонов" selected={source === "TEMPLATE"}
          onPress={() => { setSource("TEMPLATE"); setTitle(""); }} />
      </View>
      {source === "TEMPLATE" ? <>
        {templates.length === 0 ? <InlineNotice kind="info">Шаблонов мезоциклов и Расширенных программ пока нет. Сохраните их из меню «⋯» программы.</InlineNotice> : null}
        <SearchableSelect title="Шаблон" value={templateId} disabled={busy || templates.length === 0}
          options={templates.map((item) => ({ value: item.id, label: `${item.title} · ${templateKindLabels[item.kind]}` }))}
          onSelect={(value) => {
            const next = templates.find((item) => item.id === value);
            setTemplateId(value);
            // Шаблон мезоцикла — сразу он; из книги мезоцикл выбирается явно (§48.13.1 п. 8, §48.14.2 п. 2).
            if (next?.payload.kind === "MESOCYCLE") { setTemplateCycle("0"); setTitle(next.payload.mesocycle.title.slice(0, PROGRAM_TITLE_MAX)); }
            else { setTemplateCycle(""); setTitle(""); }
          }} />
        {template?.payload.kind === "PERIODIZED" ? <SearchableSelect title="Мезоцикл" value={templateCycle} disabled={busy}
          options={templateCycles.map((item, index) => ({ value: String(index), label: item.title }))}
          onSelect={(value) => { setTemplateCycle(value); setTitle((templateCycles[Number(value)]?.title ?? "Мезоцикл").slice(0, PROGRAM_TITLE_MAX)); }} /> : null}
      </> : <>
      <SearchableSelect title="Клиент" value={sourceClient} disabled={busy} options={[...names].map(([value, label]) => ({ value, label }))}
        onSelect={(value) => { setSourceClient(value); setSourceProgram(""); setSourceCycle(""); setTitle(""); setPlan(null); }} />
      <SearchableSelect title="Программа" value={sourceProgram} disabled={busy || programs.length === 0}
        options={programs.map((item) => ({ value: item.id, label: `${item.title}${item.archivedAt ? " · архив" : ""}` }))}
        onSelect={(value) => { setSourceProgram(value); setSourceCycle(""); setTitle(""); setPlan(null); }} />
      {!programs.length ? <InlineNotice kind="info">У этого клиента нет расширенных программ. Выберите другого клиента или создайте пустой мезоцикл.</InlineNotice> : null}
      {loading ? <LoadingState label="Открываем источник…" /> : <SearchableSelect title="Мезоцикл" value={sourceCycle}
        disabled={busy || !plan?.mesocycles.length} options={plan?.mesocycles.map((item) => ({ value: item.id, label: item.title })) ?? []}
        onSelect={(value) => { setSourceCycle(value); setTitle(`${plan?.mesocycles.find((item) => item.id === value)?.title ?? "Мезоцикл"} — копия`.slice(0, PROGRAM_TITLE_MAX)); }} />}
      {plan && !plan.mesocycles.length ? <InlineNotice kind="info">В программе пока нет мезоциклов.</InlineNotice> : null}
      </>}
      {preview !== null ? <>
        <TextField label="Название нового мезоцикла" required value={title} onChangeText={setTitle} />
        <Text style={[styles.meta, { color: colors.textSecondary }]}>{`Создать в «${target?.title ?? "…"}». Скопируется план всех ${preview.weeks.length} недель.`}</Text>
        {preview.weeks.map((week) => <View key={week.key} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text style={[styles.heading, { color: colors.textPrimary }]}>{`Неделя ${week.index} · ${weekTypeLabels[week.type]}`}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{week.workouts.map((workout) => `${workout.title} (${workout.exercises.length})`).join(" · ")}</Text>
        </View>)}
      </> : null}
      <ParticipantChips clientId={clientId} memberIds={target?.memberClientIds ?? []} selected={selected} names={names}
        onChange={setSelected} note="Кому создать копию в целевой программе" />
      <InlineNotice kind="info">Копируется план. Результаты, даты занятий, фактические заметки и история версий останутся у источника.</InlineNotice>
      {message ? <><InlineNotice kind="error">{message}</InlineNotice><AppButton label="Обновить предпросмотр" variant="secondary"
        disabled={busy} onPress={() => { setMessage(null); setRefresh((value) => value + 1); }} /></> : null}
    </ScrollView>
    <StickyEditorFooter actionLabel="Создать копию" busy={busy} disabled={preview === null || !target || !title.trim() || title.trim().length > PROGRAM_TITLE_MAX}
      onAction={() => { void save(); }} onCancel={onCancel} note="Новый мезоцикл будет независимым"
      message={message} messageKind="error" />
  </TrainingEditorLayout>;
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  heading: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
