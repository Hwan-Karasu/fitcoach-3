import { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ellipsis } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, DropdownMenu, EmptyState, FilterPill, InlineNotice, LoadingState, SearchField,
  TextField } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { templateKindLabels, templateSummary, type ProgramTemplate, type TemplateKind } from "../domain/TemplateModel.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";
import type { TrainingParticipantCandidate } from "./CreateProgramScreen.tsx";
import { ParticipantChips } from "./ParticipantChips.tsx";

type Filter = TemplateKind | "ALL";
type Action = Readonly<{ kind: "rename" | "duplicate" | "create"; template: ProgramTemplate; title: string }>;

const filters: readonly Filter[] = ["ALL", "SIMPLE", "PERIODIZED", "MESOCYCLE"];
const filterLabels: Readonly<Record<Filter, string>> = { ALL: "Все", SIMPLE: "Простые", PERIODIZED: "Расширенные", MESOCYCLE: "Мезоциклы" };

/**
 * Библиотека шаблонов тренера (§48.16): поиск и фильтр по типу; создать программу клиенту, переименовать,
 * сделать копию, удалить. Шаблон мезоцикла применяется в «+ Мезоцикл» программы. Действия с шаблоном не
 * меняют программы, созданные по нему (§48.16 п. 4).
 */
export function TemplateLibraryScreen({ clientId, repository, listCandidates, onCreated, onEdit }: Readonly<{
  clientId: string;
  repository: TrainingPlansRepositoryPort;
  listCandidates: () => Promise<readonly TrainingParticipantCandidate[]>;
  onCreated: (programId: string) => void;
  /** §48.16 п. 3: открыть шаблон для правки содержимого. */
  onEdit?: (templateId: string) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [templates, setTemplates] = useState<readonly ProgramTemplate[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [menuFor, setMenuFor] = useState<ProgramTemplate | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [members, setMembers] = useState<readonly string[]>([clientId]);
  const [candidates, setCandidates] = useState<readonly TrainingParticipantCandidate[]>([]);
  const [removing, setRemoving] = useState<ProgramTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const anchors = useRef(new Map<string, View | null>());
  const anchor = useRef<View | null>(null);

  const load = useCallback(() => {
    repository.listTemplates().then(setTemplates).catch(() => setMessage("Не удалось загрузить шаблоны."));
  }, [repository]);
  // При возврате из редактора список перечитывается.
  useFocusEffect(load);
  useEffect(() => {
    let active = true;
    listCandidates().then((rows) => { if (active) setCandidates(rows); }).catch(() => undefined);
    return () => { active = false; };
  }, [listCandidates]);

  if (templates === null) {
    return <View style={[styles.center, { backgroundColor: colors.canvas }]}>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : <LoadingState label="Открываем шаблоны…" />}
    </View>;
  }

  const needle = query.trim().toLocaleLowerCase();
  const visible = templates.filter((item) => (filter === "ALL" || item.kind === filter)
    && (needle === "" || item.title.toLocaleLowerCase().includes(needle)));

  const run = async () => {
    if (action === null) return;
    setBusy(true);
    setMessage(null);
    try {
      if (action.kind === "rename") await repository.renameTemplate(action.template.id, action.template.revision, action.title);
      else if (action.kind === "duplicate") await repository.duplicateTemplate(action.template.id, action.title);
      else {
        const program = await repository.createProgramFromTemplate(action.template.id, { title: action.title,
          clientIds: action.template.kind === "SIMPLE" ? [clientId] : members });
        onCreated(program.id);
        return;
      }
      setAction(null);
      load();
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      setMessage(code === "DRAFT_INVALID" ? "Введите название (до 80 символов)."
        : code === "TEMPLATE_REVISION_CONFLICT" ? "Шаблон изменился — список обновлён, повторите."
          : "Не удалось выполнить действие. Шаблоны и программы не изменены.");
      load();
    } finally {
      setBusy(false);
    }
  };

  const options = (template: ProgramTemplate) => [
    ...(template.kind === "MESOCYCLE" ? [] : [{ value: "create" as const, label: "Создать программу клиенту" }]),
    ...(onEdit === undefined ? [] : [{ value: "edit" as const, label: "Открыть и изменить" }]),
    { value: "rename" as const, label: "Переименовать" },
    { value: "duplicate" as const, label: "Сделать копию" },
    { value: "delete" as const, label: "Удалить" },
  ];

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SearchField query={query} onChangeQuery={setQuery} accessibilityLabel="Поиск шаблона" placeholder="Поиск по названию" />
      <View style={styles.filters}>
        {filters.map((item) => (
          <FilterPill key={item} label={filterLabels[item]} accessibilityLabel={`Тип: ${filterLabels[item]}`}
            selected={filter === item} onPress={() => setFilter(item)} />
        ))}
      </View>
      {message !== null ? <InlineNotice kind="error">{message}</InlineNotice> : null}
      {templates.length === 0 ? (
        <EmptyState reason="no-data" title="Шаблонов пока нет"
          body="Сохраните программу или мезоцикл как шаблон: на экране программы «⋯» → «Сохранить как шаблон»." />
      ) : visible.length === 0 ? (
        <Text style={[styles.meta, { color: colors.textSecondary }]}>Ничего не найдено.</Text>
      ) : visible.map((template) => (
        <View key={template.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHead}>
            <View style={styles.grow}>
              <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{template.title}</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                {`${templateKindLabels[template.kind]} · ${templateSummary(template.payload)}`}
              </Text>
            </View>
            <View ref={(node) => { anchors.current.set(template.id, node); }} collapsable={false}>
              <AppIconButton label={`Действия: ${template.title}`} icon={<Ellipsis size={22} color={colors.textPrimary} />}
                onPress={() => { anchor.current = anchors.current.get(template.id) ?? null; setMenuFor(template); }} />
            </View>
          </View>
          {template.kind === "MESOCYCLE" && action?.template.id !== template.id ? (
            <Text style={[styles.meta, { color: colors.textMuted }]}>Добавляется в программу: «+ Мезоцикл» → «Скопировать существующий».</Text>
          ) : null}
          {action?.template.id === template.id ? (
            <View style={styles.form}>
              <TextField label={action.kind === "create" ? "Название программы" : action.kind === "duplicate" ? "Название копии" : "Название"}
                required value={action.title} onChangeText={(title) => setAction({ ...action, title })} />
              {action.kind === "create" && template.kind === "PERIODIZED" ? (
                <ParticipantChips clientId={clientId} memberIds={[clientId, ...candidates.map((item) => item.id).filter((id) => id !== clientId)]}
                  names={new Map(candidates.map((item) => [item.id, item.displayName]))} selected={members} onChange={setMembers}
                  note="Каждый получит свою копию плана; результаты у всех свои." />
              ) : null}
              <View style={styles.row}>
                <View style={styles.grow}><AppButton variant="secondary" label="Отмена" disabled={busy} onPress={() => setAction(null)} /></View>
                <View style={styles.grow}><AppButton label={action.kind === "create" ? "Создать" : "Сохранить"} busy={busy}
                  disabled={action.title.trim().length === 0} onPress={() => { void run(); }} /></View>
              </View>
            </View>
          ) : null}
        </View>
      ))}
      {menuFor !== null ? (
        <DropdownMenu visible anchor={anchor} title={menuFor.title} selected="" options={options(menuFor)}
          onClose={() => setMenuFor(null)} onSelect={(value) => {
            const template = menuFor;
            setMenuFor(null);
            setMessage(null);
            if (value === "delete") { setRemoving(template); return; }
            if (value === "edit") { onEdit?.(template.id); return; }
            if (value === "") return;
            setMembers([clientId]);
            setAction({ kind: value, template, title: value === "duplicate" ? `${template.title} — копия`.slice(0, 80) : template.title });
          }} />
      ) : null}
      <ConfirmDialog visible={removing !== null} destructive confirmBusy={busy} title="Удалить шаблон?"
        description="Шаблон уйдёт из библиотеки. Программы, уже созданные по нему, не изменятся."
        confirmLabel="Удалить" onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const template = removing;
          if (template === null) return;
          setBusy(true);
          void repository.deleteTemplate(template.id).then(load).catch(() => setMessage("Не удалось удалить шаблон."))
            .finally(() => { setBusy(false); setRemoving(null); });
        }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, padding: 16, justifyContent: "center" },
  content: { padding: 16, gap: 12, paddingBottom: 96 },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  grow: { flex: 1, minWidth: 0 },
  title: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  meta: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  form: { gap: 10 },
  row: { flexDirection: "row", gap: 10 },
});
