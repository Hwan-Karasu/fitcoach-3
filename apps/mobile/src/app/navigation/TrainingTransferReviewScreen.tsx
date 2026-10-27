import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, SegmentedControl, StickyEditorFooter, TrainingEditorLayout } from "../../shared/ui/components/public.ts";
import { fonts } from "../../shared/ui/theme/typography.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { displayNameOf, thumbnailOf, TRACKING_PROFILES, type CatalogEntry } from "../../features/exercises/public.ts";
import { WorkoutsReview, type ExerciseInfo } from "../../features/training/public.ts";
import { transferReviewScopes, type TrainingTransfer } from "../../features/import/public.ts";
import { transferSummary } from "../../shared/training-transfer/TrainingTransfer.ts";
import { TransferIssuesEditor } from "./TransferIssuesEditor.tsx";

export function TrainingTransferReviewScreen({ value, mapping, catalog, clientName, busy, error, onMatch, onConfirm, onBack, onShare, planOnly = false,
  controls, controlsExpanded = false, onCorrectIssue, onParameters, parametersLabel, blocked = false, sheetMode = false, actionLabel, footerNote, blockedReason, allowUnknownDates = false,
  selectedValidation = false, viewWeek, onViewWeek, issueInputs, onIssueInputs }: Readonly<{
  selectedValidation?: boolean; viewWeek?: number; onViewWeek?: (week: number) => void;
  issueInputs?: Readonly<Record<string, string>>; onIssueInputs?: (inputs: Readonly<Record<string, string>>) => void;
  allowUnknownDates?: boolean;
  actionLabel?: string; footerNote?: string; blockedReason?: string;
  planOnly?: boolean;
  value: TrainingTransfer; mapping: Readonly<Record<string, string>>; catalog: readonly CatalogEntry[];
  clientName: string | null; busy: boolean; error: string;
  onMatch: (sourceExerciseId: string) => void; onConfirm: () => void; onBack: () => void; onShare: () => void;
  controls?: ReactNode; controlsExpanded?: boolean; blocked?: boolean; sheetMode?: boolean;
  onCorrectIssue?: (id: string, correction: string) => void; onParameters?: () => void; parametersLabel?: string;
}>) {
  const { palette } = usePrototypeTheme(); const colors = palette.tokens;
  const scroll = useRef<ScrollView>(null);
  useEffect(() => { if (controlsExpanded) scroll.current?.scrollTo({ y: 0, animated: true }); }, [controlsExpanded]);
  const scopes = useMemo(() => transferReviewScopes(value), [value]);
  const [scopeId, setScopeId] = useState(scopes[0]?.id ?? "");
  const [localWeek, setLocalWeek] = useState(scopes[0]?.weeks[0]?.index ?? 1);
  const weekIndex = viewWeek ?? localWeek;
  const setWeekIndex = (index: number) => { if (onViewWeek) onViewWeek(index); else setLocalWeek(index); };
  const scope = scopes.find((s) => s.id === scopeId) ?? scopes[0];
  const week = scope?.weeks.find((w) => w.index === weekIndex) ?? scope?.weeks[0];
  const names = useMemo(() => new Map(value.exercises.map((e) => [e.id, e.name])), [value]);
  const matches = useMemo(() => {
    const targets = new Map(catalog.map((entry) => [entry.definition.id, entry])); const result = new Map<string, ExerciseInfo>();
    for (const [source, target] of Object.entries(mapping)) {
      const entry = targets.get(target); if (!entry) continue;
      result.set(source, { name: displayNameOf(entry), metrics: TRACKING_PROFILES[entry.definition.trackingProfile], thumbnail: thumbnailOf(entry.definition.media), unilateral: entry.definition.unilateral });
    }
    return result;
  }, [mapping, catalog]);
  const unresolved = value.exercises.filter((e) => !matches.has(e.id)).length;
  const missingDates = value.sessions.filter((s) => s.actualDate === null).length;
  const summary = transferSummary(value);
  const programs = value.programs.filter((p) => scopes.some((s) => s.programId === p.id)).map((p) => ({ id: JSON.stringify(p.id), label: p.title }));
  if (scopes.some((s) => s.programId === null)) programs.push({ id: "null", label: "Упражнения из истории" });
  const chooseScope = (id: string) => { setScopeId(id); setWeekIndex(scopes.find((s) => s.id === id)?.weeks[0]?.index ?? 1); };
  return <TrainingEditorLayout>
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
      {controls}
      <Text style={[styles.heading, { color: colors.textPrimary }]}>Сверка упражнений в конструкторе</Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>{planOnly ? "План выбранного листа. После сверки он откроется для редактирования в конструкторе. Историю результатов можно перенести через импорт в карточке клиента." : `Клиент: ${clientName ?? "не выбран"} · Программ: ${summary.programs} · Занятий: ${summary.sessions} · Подходов: ${summary.sets}`}</Text>
      {!!error && <InlineNotice kind="error">{error}</InlineNotice>}
      <InlineNotice kind={unresolved ? "warning" : "success"}>{unresolved ? `Нужно выбрать упражнений: ${unresolved} из ${value.exercises.length}.` : `Сопоставлены все упражнения: ${value.exercises.length}.`}</InlineNotice>
      {!clientName && <InlineNotice>Выберите или создайте клиента в параметрах импорта.</InlineNotice>}
      {onCorrectIssue ? <TransferIssuesEditor value={value} busy={busy} onCorrect={onCorrectIssue} inputs={issueInputs} onInputs={onIssueInputs} />
        : !!value.issues?.length && <InlineNotice>Значений для проверки: {value.issues.length}. Исправьте лист «Проверить значения» в сохранённой матрице и выберите исправленный файл.</InlineNotice>}
      {!!missingDates && <InlineNotice>{allowUnknownDates ? `Занятий с неизвестной датой: ${missingDates}. Даты останутся неизвестными.` : `Занятий с неизвестной датой: ${missingDates}. Для переноса фактических результатов укажите даты в Excel. План без дат можно загрузить через конструктор.`}</InlineNotice>}
      {!!(value.issues?.length || missingDates) && <AppButton label="Сохранить матрицу для проверки" variant="secondary" disabled={busy} onPress={onShare} />}
      <View style={[styles.settings, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[styles.heading, { color: colors.textPrimary }]}>Программа</Text>
        {!!programs.length && !sheetMode && <SegmentedControl scroll items={programs} selectedId={JSON.stringify(scope?.programId ?? null)} onSelect={(id) => { const next = scopes.find((s) => JSON.stringify(s.programId) === id); if (next) chooseScope(next.id); }} />}
        {scope && scopes.filter((s) => s.programId === scope.programId).length > 1 && <SegmentedControl scroll items={scopes.filter((s) => s.programId === scope.programId).map((s) => ({ id: s.id, label: s.title }))} selectedId={scope.id} onSelect={chooseScope} />}
        {!!scope?.weeks.length && scope.programId !== null && <SegmentedControl scroll items={scope.weeks.map((w) => ({ id: String(w.index), label: `Неделя ${w.index}` }))} selectedId={String(week?.index)} onSelect={(id) => setWeekIndex(Number(id))} />}
      </View>
      {week && <WorkoutsReview workouts={week.workouts} names={names} matches={matches} onMatch={onMatch} disabled={busy} />}
      {!scopes.length && <InlineNotice>В файле нет упражнений для сверки.</InlineNotice>}
    </ScrollView>
    <StickyEditorFooter actionLabel={actionLabel ?? (planOnly ? "Открыть в конструкторе" : "Подтвердить импорт")} onAction={onConfirm} busy={busy}
      disabled={blocked || !clientName || (!selectedValidation && (!value.programs.length || unresolved > 0 || (!allowUnknownDates && missingDates > 0) || !!value.issues?.length))}
      note={blocked ? blockedReason ?? "Примените настройки столбцов перед импортом." : footerNote ?? (planOnly ? "Программа появится после сохранения в конструкторе." : sheetMode ? "Будет импортирован только открытый лист." : "Выбор упражнения применяется ко всем его вхождениям в этой книге.")}
      secondaryAction={{ label: parametersLabel ?? (planOnly ? "Выбрать другой лист" : "Параметры импорта"), onPress: onParameters ?? onBack }} />
  </TrainingEditorLayout>;
}
const styles = StyleSheet.create({ content: { padding: 16, gap: 12, paddingBottom: 24 }, settings: { padding: 12, gap: 10, borderWidth: 1, borderRadius: 12 }, heading: { fontFamily: fonts.semibold, fontSize: 16 }, body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 } });
