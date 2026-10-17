import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ChevronDown, ChevronRight, CircleAlert, EllipsisVertical, Eye, Lock, PencilLine, Plus, Redo2,
  Undo2 } from "lucide-react-native";
import { AppButton, AppIconButton, ConfirmDialog, InlineNotice, LoadingState, StickyEditorFooter, TextField,
  type NoticeKind } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { addField, addSection, duplicateField, locateField, moveField, moveFieldToSection, moveSection, publishedHasField,
  removeField, removeSection, restoreField, setFieldHidden, updateSection } from "../domain/QuestionnaireBuilder.ts";
import { QUESTION_TYPES, type PublishSummary, type QuestionField, type QuestionSection } from "../domain/QuestionnaireModel.ts";
import { sameSchema, validateSchema } from "../domain/QuestionnaireRules.ts";
import { ActionSheet, type SheetAction } from "./ActionSheet.tsx";
import { FieldEditorSheet, typeLabels } from "./FieldEditorSheet.tsx";
import { QuestionnaireForm, type FormInputs } from "./QuestionnaireForm.tsx";
import { errorCode, newBuilderId, useQuestionnaireBuilder } from "./useQuestionnaireBuilder.ts";
import type { QuestionnaireRepositoryPort } from "../domain/QuestionnaireRepositoryPort.ts";

type Menu =
  | Readonly<{ kind: "FIELD"; id: string }>
  | Readonly<{ kind: "MOVE"; id: string }>
  | Readonly<{ kind: "SECTION"; id: string }>
  | Readonly<{ kind: "ADD"; sectionId: string }>
  | Readonly<{ kind: "BUILDER" }>
  | Readonly<{ kind: "VERSIONS"; versions: readonly Readonly<{ version: number; publishedAt: string }>[] }>;

type Confirm =
  | Readonly<{ kind: "PUBLISH"; summary: PublishSummary }>
  | Readonly<{ kind: "REPLACE"; source: number | "DEFAULT" | "PUBLISHED"; title: string; description: string; done: string }>;

export function questionsWord(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} вопросов`;
  if (count % 10 === 1) return `${count} вопрос`;
  return count % 10 >= 2 && count % 10 <= 4 ? `${count} вопроса` : `${count} вопросов`;
}

const publishErrors: Readonly<Record<string, string>> = {
  QUESTIONNAIRE_NOTHING_TO_PUBLISH: "Черновик совпадает с опубликованной версией — публиковать нечего.",
  QUESTIONNAIRE_STALE_BASE: "Пока шла правка, опубликована другая версия. Сбросьте черновик в меню «⋮» и повторите правки.",
  QUESTIONNAIRE_ANSWERED_FIELD_REMOVED: "Вопрос или вариант с ответами клиентов нельзя удалить — уберите его из анкеты.",
  QUESTIONNAIRE_ANSWERED_TYPE_CHANGED: "У вопроса с ответами клиентов нельзя менять тип.",
  QUESTIONNAIRE_SCHEMA_INVALID: "В анкете есть ошибки — они отмечены у вопросов.",
  QUESTIONNAIRE_VERSION_NOT_FOUND: "Такой версии анкеты нет.",
};

function summaryText(summary: PublishSummary, nextVersion: number): string {
  const lines = [
    summary.added > 0 ? `Новых вопросов: ${summary.added}` : null,
    summary.changed > 0 ? `Изменено вопросов: ${summary.changed}` : null,
    summary.hidden > 0 ? `Скрыто: ${summary.hidden}` : null,
    summary.retired > 0 ? `Убрано из анкеты (ответы сохранятся): ${summary.retired}` : null,
    summary.removed > 0 ? `Удалено: ${summary.removed}` : null,
    summary.moved > 0 ? `Перемещено: ${summary.moved}` : null,
    summary.sections > 0 ? `Изменений в разделах: ${summary.sections}` : null,
  ].filter((line): line is string => line !== null);
  return [`Анкета станет версией ${nextVersion}. Ответы клиентов не меняются.`, ...lines].join("\n");
}

function hasChanges(summary: PublishSummary): boolean {
  return Object.values(summary).some((count) => count > 0);
}

function formatPublishedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso
    : date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Конструктор анкеты (§§25, 27): один черновик с автосохранением, сворачиваемые разделы, строки
 * вопросов с меню «⋮», редактор вопроса в нижнем окне, отмена/повтор, предпросмотр тем же отрисовщиком,
 * что у клиента, публикация со сводкой. Перемещение — пунктами меню (перетаскивание — отдельная проверка).
 */
export function QuestionnaireBuilderScreen({ repository }: Readonly<{ repository: QuestionnaireRepositoryPort }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const builder = useQuestionnaireBuilder(repository);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewInputs, setPreviewInputs] = useState<FormInputs>({});
  const [showIssues, setShowIssues] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Readonly<{ kind: NoticeKind; text: string }> | null>(null);

  const { schema, published } = builder;
  if (schema === null || published === null) {
    return (
      <View style={[styles.center, { backgroundColor: colors.canvas }]}>
        {builder.loadFailed ? <>
          <InlineNotice kind="error">Анкета не загрузилась. Черновик не изменён.</InlineNotice>
          <AppButton variant="secondary" label="Повторить" onPress={() => { void builder.load(); }} />
        </> : <LoadingState label="Открываем конструктор…" />}
      </View>
    );
  }

  const issues = showIssues ? validateSchema(schema) : [];
  const issueFields = new Set(issues.map((issue) => issue.fieldId));
  const changed = !sameSchema(schema, published.schema);
  const toggle = (id: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const say = (kind: NoticeKind, text: string) => setMessage({ kind, text });

  const startPublish = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await builder.preparePublish();
      if (result.kind === "UNSAVED") say("error", "Черновик не сохранился. Проверьте и повторите публикацию.");
      else if (result.kind === "ISSUES") {
        setShowIssues(true);
        const broken = new Set(result.issues.map((issue) => issue.fieldId));
        setCollapsed((current) => new Set([...current].filter((id) =>
          !schema.sections.some((section) => section.id === id && section.fields.some((field) => broken.has(field.id))))));
        const general = result.issues.filter((issue) => issue.fieldId === null).map((issue) => issue.message);
        say("error", [`Исправьте перед публикацией: ошибок ${result.issues.length}. Вопросы с ошибкой отмечены.`,
          ...general].join("\n"));
      } else if (!hasChanges(result.summary)) say("info", publishErrors.QUESTIONNAIRE_NOTHING_TO_PUBLISH!);
      else setConfirm({ kind: "PUBLISH", summary: result.summary });
    } catch (error) {
      say("error", publishErrors[errorCode(error)] ?? "Не удалось подготовить публикацию. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  const confirmAction = async () => {
    if (confirm === null) return;
    setBusy(true);
    try {
      if (confirm.kind === "PUBLISH") {
        const version = await builder.publish();
        setShowIssues(false);
        say("success", `Опубликована версия ${version.version}. Новые ответы клиентов — по ней.`);
      } else {
        await builder.replaceDraft(confirm.source);
        setShowIssues(false);
        say("success", confirm.done);
      }
    } catch (error) {
      say("error", publishErrors[errorCode(error)] ?? (confirm.kind === "PUBLISH"
        ? "Не удалось опубликовать. Черновик сохранён, попробуйте ещё раз." : "Не удалось заменить черновик."));
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const openVersions = async () => {
    try {
      setMenu({ kind: "VERSIONS", versions: [...await builder.listVersions()].reverse() });
    } catch {
      say("error", "Не удалось загрузить историю версий.");
    }
  };

  const fieldActions = (field: QuestionField, section: QuestionSection, index: number): SheetAction[] => {
    const wasPublished = publishedHasField(published.schema, field.id);
    const actions: SheetAction[] = [
      { key: "edit", label: "Настроить", onPress: () => setEditing(field.id) },
      { key: "copy", label: "Дублировать", onPress: () => {
        const id = newBuilderId();
        builder.apply((current) => duplicateField(current, field.id, id, (at) => `${id}:o${at + 1}`));
        setEditing(id);
      } },
      { key: "move", label: "Переместить в раздел…", disabled: schema.sections.length < 2,
        onPress: () => setMenu({ kind: "MOVE", id: field.id }) },
      { key: "up", label: "Выше", disabled: index === 0, onPress: () => builder.apply((current) => moveField(current, field.id, -1)) },
      { key: "down", label: "Ниже", disabled: index === section.fields.length - 1,
        onPress: () => builder.apply((current) => moveField(current, field.id, 1)) },
    ];
    if (field.retired) {
      actions.push({ key: "restore", label: "Вернуть в анкету", onPress: () => builder.apply((current) => restoreField(current, field.id)) });
      return actions;
    }
    actions.push({ key: "hide", label: field.hidden ? "Показать" : "Скрыть",
      detail: field.hidden ? undefined : "Вопрос не виден в анкете, ответы сохраняются",
      onPress: () => builder.apply((current) => setFieldHidden(current, field.id, !field.hidden)) });
    if (field.origin === "SYSTEM") {
      actions.push({ key: "remove", label: "Удалить", disabled: true, detail: "Системный вопрос можно только скрыть", onPress: () => undefined });
    } else {
      actions.push({ key: "remove", danger: true, label: wasPublished ? "Убрать из анкеты" : "Удалить",
        detail: wasPublished ? "Ответы клиентов сохранятся, вопрос можно вернуть" : undefined,
        onPress: () => {
          const result = removeField(schema, field.id, published.schema);
          builder.apply((current) => removeField(current, field.id, published.schema).schema);
          say("info", result.outcome === "RETIRED" ? "Вопрос убран из анкеты. Вернуть — в его меню «⋮»." : "Вопрос удалён. Вернуть — «Отменить».");
        } });
    }
    return actions;
  };

  const sectionActions = (section: QuestionSection, index: number): SheetAction[] => [
    { key: "rename", label: "Переименовать", onPress: () => { setRenaming(section.id); setCollapsed((current) => {
      const next = new Set(current); next.delete(section.id); return next;
    }); } },
    { key: "hide", label: section.hidden ? "Показать раздел" : "Скрыть раздел",
      onPress: () => builder.apply((current) => updateSection(current, section.id, { hidden: !section.hidden })) },
    { key: "up", label: "Выше", disabled: index === 0, onPress: () => builder.apply((current) => moveSection(current, section.id, -1)) },
    { key: "down", label: "Ниже", disabled: index === schema.sections.length - 1,
      onPress: () => builder.apply((current) => moveSection(current, section.id, 1)) },
    { key: "remove", label: "Удалить раздел", danger: true,
      disabled: section.origin === "SYSTEM" || section.fields.length > 0,
      detail: section.origin === "SYSTEM" ? "Системный раздел можно только скрыть"
        : section.fields.length > 0 ? "Сначала перенесите вопросы в другой раздел" : undefined,
      onPress: () => builder.apply((current) => removeSection(current, section.id).schema) },
  ];

  const menuContent = (): Readonly<{ title: string; actions: readonly SheetAction[] }> => {
    if (menu === null) return { title: "", actions: [] };
    if (menu.kind === "FIELD" || menu.kind === "MOVE") {
      const found = locateField(schema, menu.id);
      if (found === null) return { title: "", actions: [] };
      const label = found.field.label.trim() || "Вопрос без текста";
      if (menu.kind === "FIELD") return { title: label, actions: fieldActions(found.field, found.section, found.index) };
      return { title: `Переместить «${label}» в раздел`, actions: schema.sections.filter((section) => section.id !== found.section.id)
        .map((section) => ({ key: section.id, label: section.title.trim() || "Раздел без названия",
          onPress: () => builder.apply((current) => moveFieldToSection(current, menu.id, section.id)) })) };
    }
    if (menu.kind === "SECTION") {
      const index = schema.sections.findIndex((section) => section.id === menu.id);
      const section = schema.sections[index];
      return section === undefined ? { title: "", actions: [] }
        : { title: section.title.trim() || "Раздел без названия", actions: sectionActions(section, index) };
    }
    if (menu.kind === "ADD") {
      return { title: "Тип ответа нового вопроса", actions: QUESTION_TYPES.map((type) => ({ key: type, label: typeLabels[type],
        onPress: () => {
          const id = newBuilderId();
          builder.apply((current) => addField(current, menu.sectionId, type, id));
          setEditing(id);
        } })) };
    }
    if (menu.kind === "VERSIONS") {
      return { title: "Создать черновик из версии", actions: menu.versions.map((entry) => ({
        key: String(entry.version),
        label: `Версия ${entry.version}${entry.version === published.version ? " · текущая" : ""}`,
        detail: formatPublishedAt(entry.publishedAt),
        onPress: () => setConfirm({ kind: "REPLACE", source: entry.version, title: `Черновик из версии ${entry.version}?`,
          description: "Текущий черновик заменится структурой этой версии. Опубликовать нужно будет отдельно; ответы клиентов не меняются.",
          done: `Черновик создан из версии ${entry.version}. Проверьте и опубликуйте.` }),
      })) };
    }
    return { title: "Анкета", actions: [
      { key: "history", label: "История версий", detail: `Опубликовано версий: ${published.version}`, onPress: () => { void openVersions(); } },
      { key: "discard", label: "Сбросить черновик", disabled: !changed,
        detail: changed ? "Вернуть структуру опубликованной версии" : "Черновик совпадает с опубликованной версией",
        onPress: () => setConfirm({ kind: "REPLACE", source: "PUBLISHED", title: "Сбросить черновик?",
          description: `Все неопубликованные правки пропадут, черновик станет версией ${published.version}.`,
          done: "Черновик сброшен к опубликованной версии." }) },
      { key: "default", label: "Стандартная анкета", detail: "Черновик из стандартного набора вопросов",
        onPress: () => setConfirm({ kind: "REPLACE", source: "DEFAULT", title: "Взять стандартную анкету?",
          description: "Черновик заменится стандартным набором вопросов. Опубликовать нужно будет отдельно; ответы клиентов не меняются.",
          done: "Черновик заменён стандартной анкетой. Проверьте и опубликуйте." }) },
    ] };
  };

  const saveLabel = builder.saveState === "pending" ? "Сохраняется…" : builder.saveState === "failed" ? "Черновик не сохранился"
    : changed ? "Черновик сохранён · не опубликован" : "Совпадает с опубликованной";
  const sheet = menuContent();

  const fieldRow = (field: QuestionField) => {
    const markers = [typeLabels[field.type], field.origin === "SYSTEM" ? "Системный" : null,
      field.required ? "Обязательное" : null, field.visibleIf !== null ? "Условие" : null,
      field.retired ? "Убран из анкеты" : field.hidden ? "Скрыто" : null].filter((item) => item !== null).join(" · ");
    const broken = issueFields.has(field.id);
    const label = field.label.trim() || "Вопрос без текста";
    return (
      <Pressable key={field.id} accessibilityRole="button" accessibilityLabel={`${label}. ${markers}${broken ? ". Есть ошибка" : ""}`}
        onPress={() => setEditing(field.id)}
        style={({ pressed }) => [styles.fieldRow, { borderTopColor: colors.border,
          backgroundColor: pressed ? colors.surfaceRaised : "transparent", opacity: field.retired || field.hidden ? 0.6 : 1 }]}>
        <View style={styles.grow}>
          <Text numberOfLines={2} style={[styles.fieldLabel, { color: field.label.trim() ? colors.textPrimary : colors.textMuted }]}>{label}</Text>
          <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>{markers}</Text>
        </View>
        {broken ? <CircleAlert size={18} color={colors.danger} strokeWidth={2} /> : null}
        <AppIconButton compact label={`Действия: ${label}`} icon={<EllipsisVertical size={18} color={colors.textSecondary} strokeWidth={1.8} />}
          onPress={() => setMenu({ kind: "FIELD", id: field.id })} />
      </Pressable>
    );
  };

  const sectionCard = (section: QuestionSection) => {
    const open = !collapsed.has(section.id);
    const count = section.fields.filter((field) => !field.retired).length;
    const broken = section.fields.some((field) => issueFields.has(field.id)) || (showIssues && !section.title.trim());
    const title = section.title.trim() || "Раздел без названия";
    return (
      <View key={section.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: broken ? colors.danger : colors.border }]}>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`Раздел ${title}, ${questionsWord(count)}`}
          onPress={() => toggle(section.id)} style={styles.sectionHead}>
          {open ? <ChevronDown size={18} color={colors.textSecondary} strokeWidth={2} />
            : <ChevronRight size={18} color={colors.textSecondary} strokeWidth={2} />}
          <View style={styles.grow}>
            <Text numberOfLines={1} style={[styles.sectionTitle, { color: colors.textPrimary, opacity: section.hidden ? 0.6 : 1 }]}>{title}</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]}>
              {[questionsWord(count), section.hidden ? "Скрыт" : null].filter((item) => item !== null).join(" · ")}
            </Text>
          </View>
          {broken ? <CircleAlert size={18} color={colors.danger} strokeWidth={2} /> : null}
          <AppIconButton compact label={`Действия с разделом ${title}`}
            icon={<EllipsisVertical size={18} color={colors.textSecondary} strokeWidth={1.8} />}
            onPress={() => setMenu({ kind: "SECTION", id: section.id })} />
        </Pressable>
        {open ? <>
          {renaming === section.id ? (
            <View style={[styles.rename, { borderTopColor: colors.border }]}>
              <TextField label="Название раздела" required value={section.title}
                onChangeText={(value) => builder.apply((current) => updateSection(current, section.id, { title: value }), `section:${section.id}`)} />
              <AppButton compact variant="secondary" label="Готово" onPress={() => setRenaming(null)} />
            </View>
          ) : null}
          {section.fields.map(fieldRow)}
          {section.fields.length === 0 ? (
            <Text style={[styles.empty, { color: colors.textMuted, borderTopColor: colors.border }]}>В разделе нет вопросов.</Text>
          ) : null}
          <Pressable accessibilityRole="button" accessibilityLabel={`Добавить вопрос в раздел ${title}`}
            onPress={() => setMenu({ kind: "ADD", sectionId: section.id })}
            style={({ pressed }) => [styles.addRow, { borderTopColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : "transparent" }]}>
            <Plus size={16} color={colors.accentInk} strokeWidth={2} />
            <Text style={[styles.addText, { color: colors.accentInk }]}>Добавить вопрос</Text>
          </Pressable>
        </> : null}
      </View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.canvas }]}>
      <View style={[styles.toolbar, { borderBottomColor: colors.border, backgroundColor: colors.canvas }]}>
        <View style={styles.grow}>
          <Text numberOfLines={1} style={[styles.status, { color: colors.textPrimary }]}>{`Опубликована версия ${published.version}`}</Text>
          {builder.saveState === "failed" ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Черновик не сохранился. Повторить сохранение"
              onPress={() => { void builder.flush(); }}>
              <Text style={[styles.meta, { color: colors.danger }]}>Черновик не сохранился · Повторить</Text>
            </Pressable>
          ) : <Text numberOfLines={1} style={[styles.meta, { color: colors.textSecondary }]}>{saveLabel}</Text>}
        </View>
        <AppIconButton compact label="Отменить" disabled={!builder.canUndo || preview}
          icon={<Undo2 size={20} color={colors.textPrimary} strokeWidth={1.8} />} onPress={builder.undo} />
        <AppIconButton compact label="Повторить" disabled={!builder.canRedo || preview}
          icon={<Redo2 size={20} color={colors.textPrimary} strokeWidth={1.8} />} onPress={builder.redo} />
        <AppIconButton compact label={preview ? "Вернуться к правке" : "Предпросмотр"}
          icon={preview ? <PencilLine size={20} color={colors.accentInk} strokeWidth={1.8} />
            : <Eye size={20} color={colors.textPrimary} strokeWidth={1.8} />}
          onPress={() => { setPreview((value) => !value); setPreviewInputs({}); }} />
        <AppIconButton compact label="Меню анкеты" icon={<EllipsisVertical size={20} color={colors.textPrimary} strokeWidth={1.8} />}
          onPress={() => setMenu({ kind: "BUILDER" })} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {builder.reloaded ? <InlineNotice kind="info">Черновик изменился в другом месте — показан сохранённый вариант.</InlineNotice> : null}
        {builder.baseVersion !== published.version ? <InlineNotice kind="info">
          {`Черновик начат с версии ${builder.baseVersion}, а опубликована ${published.version}. Перед публикацией сбросьте черновик в меню «⋮».`}
        </InlineNotice> : null}
        {message !== null ? <InlineNotice kind={message.kind}>{message.text}</InlineNotice> : null}
        {preview ? <>
          <InlineNotice kind="info">Предпросмотр черновика так, как его увидит тренер в карточке клиента. Тестовые ответы не сохраняются.</InlineNotice>
          <QuestionnaireForm schema={schema} inputs={previewInputs} errors={{}}
            onChange={(fieldId, value) => setPreviewInputs((current) => ({ ...current, [fieldId]: value }))} />
        </> : <>
          <View style={[styles.card, styles.anchor, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Lock size={18} color={colors.textSecondary} strokeWidth={1.8} />
            <View style={styles.grow}>
              <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>Основное</Text>
              <Text style={[styles.meta, { color: colors.textSecondary }]}>
                Имя, телефон, почта, дата рождения, рост — заполняются в карточке клиента и здесь не меняются.
              </Text>
            </View>
          </View>
          {schema.sections.map(sectionCard)}
          <AppButton variant="secondary" label="Добавить раздел" icon={(color) => <Plus size={18} color={color} strokeWidth={2} />}
            onPress={() => {
              const id = newBuilderId();
              builder.apply((current) => addSection(current, id, "Новый раздел"));
              setRenaming(id);
            }} />
        </>}
      </ScrollView>

      <StickyEditorFooter actionLabel={changed ? "Опубликовать" : "Нет изменений для публикации"} busy={busy}
        disabled={!changed || builder.saveState === "failed"} onAction={() => { void startPublish(); }}
        note="Опубликованная версия не меняется: правки идут в новую версию" />

      <ActionSheet visible={menu !== null} title={sheet.title} actions={sheet.actions} onClose={() => setMenu(null)} />
      <FieldEditorSheet schema={schema} published={published.schema} fieldId={editing}
        apply={(change) => builder.apply(change, `field:${editing ?? ""}`)} newId={newBuilderId}
        onClose={() => setEditing(null)} />
      <ConfirmDialog visible={confirm !== null} confirmBusy={busy}
        title={confirm === null ? "" : confirm.kind === "PUBLISH" ? "Опубликовать анкету?" : confirm.title}
        description={confirm === null ? "" : confirm.kind === "PUBLISH" ? summaryText(confirm.summary, published.version + 1) : confirm.description}
        confirmLabel={confirm?.kind === "PUBLISH" ? "Опубликовать" : "Заменить черновик"}
        destructive={confirm?.kind === "REPLACE"}
        onCancel={() => setConfirm(null)} onConfirm={() => { void confirmAction(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, padding: 16, gap: 12, justifyContent: "center" },
  toolbar: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 4, paddingVertical: 6, gap: 2,
    borderBottomWidth: 1 },
  status: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19 },
  content: { padding: 16, gap: 12, paddingBottom: 24 },
  grow: { flex: 1, minWidth: 0 },
  card: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  anchor: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 12, paddingRight: 4, minHeight: 56 },
  sectionTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  fieldRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 12, paddingRight: 4, paddingVertical: 6,
    minHeight: 52, borderTopWidth: StyleSheet.hairlineWidth },
  fieldLabel: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
  rename: { padding: 12, gap: 8, borderTopWidth: StyleSheet.hairlineWidth },
  empty: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
  addRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth },
  addText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
});
