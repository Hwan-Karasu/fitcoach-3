import { useEffect, useRef } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from "lucide-react-native";
import { AppIconButton, ChoiceGrid, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { addOption, canChangeType, CHOICE_TYPES, locateField, moveOption, removeOption, renameOption, restoreOption,
  updateField } from "../domain/QuestionnaireBuilder.ts";
import { QUESTION_TYPES, type FieldConstraints, type QuestionField, type QuestionnaireSchema,
  type QuestionType, type VisibilityRule } from "../domain/QuestionnaireModel.ts";
import { allFields, validateSchema } from "../domain/QuestionnaireRules.ts";
import { choiceColumns } from "./choiceLayout.ts";
import { typeIcons } from "./typeIcons.ts";

export const typeLabels: Readonly<Record<QuestionType, string>> = {
  SHORT_TEXT: "Короткий текст", LONG_TEXT: "Длинный текст", NUMBER: "Число", DATE: "Дата",
  SINGLE_CHOICE: "Один вариант", MULTI_CHOICE: "Несколько вариантов", SWITCH: "Переключатель",
};

const operatorLabels: Readonly<Record<VisibilityRule["operator"], string>> = { EQUALS: "равно", NOT_EQUALS: "не равно", CONTAINS: "содержит" };

function operatorsFor(type: QuestionType): readonly VisibilityRule["operator"][] {
  if (type === "MULTI_CHOICE" || type === "SHORT_TEXT" || type === "LONG_TEXT") return ["EQUALS", "NOT_EQUALS", "CONTAINS"];
  return ["EQUALS", "NOT_EQUALS"];
}

function numberOrUndefined(text: string): number | undefined {
  const value = Number(text.replace(",", "."));
  return text.trim() === "" || !Number.isFinite(value) ? undefined : value;
}

function constraintsOf(field: QuestionField): FieldConstraints { return field.constraints ?? {}; }

/** §27.4 Редактор вопроса в нижнем окне: текст, подсказка, обязательность, тип, варианты, условие, ограничения. */
export function FieldEditorSheet({ schema, published, fieldId, showIssues, apply, newId, onClose }: Readonly<{
  schema: QuestionnaireSchema;
  published: QuestionnaireSchema;
  fieldId: string | null;
  /** Ошибки показываются после попытки публикации, а не сразу у нового вопроса. */
  showIssues: boolean;
  /** Правка схемы черновика (попадает в отмену/повтор и автосохранение). */
  apply: (change: (schema: QuestionnaireSchema) => QuestionnaireSchema) => void;
  newId: () => string;
  onClose: () => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const found = fieldId === null ? null : locateField(schema, fieldId);
  const field = found?.field ?? null;
  const patch = (value: Parameters<typeof updateField>[2]) => { if (field !== null) apply((current) => updateField(current, field.id, value)); };
  const labelRef = useRef<TextInput>(null);
  // Новый вопрос без текста: сразу ставим курсор в поле текста.
  const emptyLabel = field !== null && field.label === "";
  useEffect(() => {
    if (!emptyLabel) return undefined;
    const timer = setTimeout(() => labelRef.current?.focus(), 350);
    return () => clearTimeout(timer);
  }, [fieldId, emptyLabel]);
  const issues = field === null || !showIssues ? [] : validateSchema(schema).filter((issue) => issue.fieldId === field.id);
  const sources = field === null ? [] : allFields(schema).map((item) => item.field)
    .filter((entry) => entry.id !== field.id && !entry.retired);
  const rule = field?.visibleIf ?? null;
  const source = rule === null ? null : sources.find((entry) => entry.id === rule.sourceFieldId) ?? null;
  const limits = field === null ? {} : constraintsOf(field);
  const setLimits = (next: FieldConstraints) => patch({ constraints: Object.values(next).some((value) => value !== undefined) ? next : null });

  return (
    <Modal visible={field !== null} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Закрыть редактор вопроса" style={[StyleSheet.absoluteFill, styles.scrim]} onPress={onClose} />
      <View style={[styles.sheet, { marginTop: insets.top + 48, backgroundColor: colors.canvas, borderColor: colors.border }]}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
            {field?.origin === "SYSTEM" ? "Системный вопрос" : "Вопрос"}
          </Text>
          <AppIconButton compact label="Готово" icon={<X size={22} color={colors.textPrimary} strokeWidth={1.8} />} onPress={onClose} />
        </View>
        {field !== null ? (
          <ScrollView contentContainerStyle={[styles.body, { paddingBottom: 24 + insets.bottom }]} keyboardShouldPersistTaps="handled">
            {issues.length > 0 ? (
              <Text accessibilityRole="alert" style={[styles.issue, { color: colors.danger }]}>
                {issues.map((issue) => `• ${issue.message}`).join("\n")}
              </Text>
            ) : null}
            <TextField label="Текст вопроса" required value={field.label} inputRef={labelRef} onChangeText={(label) => patch({ label })} />
            <TextField label="Подсказка · необязательно" value={field.help ?? ""}
              onChangeText={(help) => patch({ help: help.trim() === "" ? null : help })} />

            <Text style={[styles.group, { color: colors.textPrimary }]}>Обязательный вопрос</Text>
            <ChoiceGrid group="Обязательный" columns={2} items={[{ id: "yes", label: "Да" }, { id: "no", label: "Нет" }]}
              selected={[field.required ? "yes" : "no"]} onPress={(id) => patch({ required: id === "yes" })} />
            <Text style={[styles.note, { color: colors.textSecondary }]}>Без ответа на обязательный вопрос анкета не считается заполненной полностью.</Text>

            <Text style={[styles.group, { color: colors.textPrimary }]}>Тип ответа</Text>
            {canChangeType(field, published) ? (
              <ChoiceGrid group="Тип ответа" columns={choiceColumns(QUESTION_TYPES.map((type) => typeLabels[type]))} selected={[field.type]}
                items={QUESTION_TYPES.map((type) => ({ id: type, label: typeLabels[type], icon: typeIcons[type] }))}
                onPress={(id) => patch({ type: id as QuestionType })} />
            ) : (
              <Text style={[styles.note, { color: colors.textSecondary }]}>
                {`${typeLabels[field.type]}. Тип не меняется: ${field.origin === "SYSTEM" ? "системный вопрос" : "вопрос уже опубликован, ответы привязаны к типу"}.`}
              </Text>
            )}

            {CHOICE_TYPES.includes(field.type) ? <>
              <Text style={[styles.group, { color: colors.textPrimary }]}>Варианты ответа</Text>
              {field.options.map((option, index) => (
                <View key={option.id} style={styles.optionRow}>
                  <View style={styles.optionInput}>
                    <TextField label={option.retired ? `Вариант ${index + 1} · выведен` : `Вариант ${index + 1}`}
                      value={option.label} disabled={option.retired}
                      onChangeText={(label) => apply((current) => renameOption(current, field.id, option.id, label))} />
                  </View>
                  <AppIconButton compact label="Вариант выше" disabled={index === 0}
                    icon={<ArrowUp size={18} color={colors.textSecondary} strokeWidth={1.8} />}
                    onPress={() => apply((current) => moveOption(current, field.id, option.id, -1))} />
                  <AppIconButton compact label="Вариант ниже" disabled={index === field.options.length - 1}
                    icon={<ArrowDown size={18} color={colors.textSecondary} strokeWidth={1.8} />}
                    onPress={() => apply((current) => moveOption(current, field.id, option.id, 1))} />
                  {option.retired ? (
                    <AppIconButton compact label="Вернуть вариант" icon={<RotateCcw size={18} color={colors.accentInk} strokeWidth={1.8} />}
                      onPress={() => apply((current) => restoreOption(current, field.id, option.id))} />
                  ) : (
                    <AppIconButton compact label="Убрать вариант" icon={<X size={18} color={colors.danger} strokeWidth={1.8} />}
                      onPress={() => apply((current) => removeOption(current, field.id, option.id, published).schema)} />
                  )}
                </View>
              ))}
              <Pressable accessibilityRole="button" accessibilityLabel="Добавить вариант"
                onPress={() => apply((current) => addOption(current, field.id, newId(), ""))}
                style={({ pressed }) => [styles.add, { borderColor: colors.border, backgroundColor: pressed ? colors.surfaceRaised : colors.surface }]}>
                <Plus size={16} color={colors.accentInk} strokeWidth={2} />
                <Text style={[styles.addText, { color: colors.accentInk }]}>Добавить вариант</Text>
              </Pressable>
            </> : null}

            <Text style={[styles.group, { color: colors.textPrimary }]}>Когда показывать вопрос</Text>
            <ChoiceGrid group="Когда показывать" columns={2}
              items={[{ id: "always", label: "Всегда" }, { id: "conditional", label: "Только при условии" }]}
              selected={[rule === null ? "always" : "conditional"]}
              onPress={(id) => {
                if (id === "always") { patch({ visibleIf: null }); return; }
                const first = sources[0];
                if (rule !== null || first === undefined) return;
                patch({ visibleIf: { sourceFieldId: first.id, operator: "EQUALS",
                  value: first.type === "SWITCH" ? "true" : first.options.find((option) => !option.retired)?.id ?? "" } });
              }} />
            <Text style={[styles.note, { color: colors.textSecondary }]}>
              {rule === null ? "Вопрос виден в анкете всегда. «Только при условии» — вопрос появится, когда в другом вопросе выбран нужный ответ (например, жалобы на здоровье — только если «Противопоказаний нет» = Нет)."
                : "Вопрос появится в анкете, только когда выполнено условие ниже. Пока оно не выполнено, вопрос скрыт, а сохранённые ответы не теряются."}
            </Text>
            {rule !== null && source !== null ? <>
              <Text style={[styles.group, { color: colors.textPrimary }]}>Если ответ на вопрос</Text>
              <ChoiceGrid group="Вопрос-условие" columns={1}
                items={sources.map((entry) => ({ id: entry.id, label: entry.label.trim() || "Вопрос без текста" }))}
                selected={[source.id]}
                onPress={(id) => {
                  const entry = sources.find((item) => item.id === id);
                  if (entry === undefined || entry.id === rule.sourceFieldId) return;
                  patch({ visibleIf: { sourceFieldId: entry.id, operator: "EQUALS",
                    value: entry.type === "SWITCH" ? "true" : entry.options.find((option) => !option.retired)?.id ?? "" } });
                }} />
              <Text style={[styles.group, { color: colors.textPrimary }]}>Условие</Text>
              <ChoiceGrid group="Условие" columns={operatorsFor(source.type).length}
                items={operatorsFor(source.type).map((operator) => ({ id: operator, label: operatorLabels[operator] }))}
                selected={[rule.operator]}
                onPress={(id) => patch({ visibleIf: { ...rule, operator: id as VisibilityRule["operator"] } })} />
              {CHOICE_TYPES.includes(source.type) ? <>
                <Text style={[styles.group, { color: colors.textPrimary }]}>Значение</Text>
                <ChoiceGrid group="Значение" disabled={false}
                  columns={choiceColumns(source.options.filter((option) => !option.retired).map((option) => option.label))}
                  items={source.options.filter((option) => !option.retired).map((option) => ({ id: option.id, label: option.label || "Без текста" }))}
                  selected={[rule.value]} onPress={(id) => patch({ visibleIf: { ...rule, value: id } })} />
              </> : source.type === "SWITCH" ? <>
                <Text style={[styles.group, { color: colors.textPrimary }]}>Значение</Text>
                <ChoiceGrid group="Значение" columns={2} items={[{ id: "true", label: "Да" }, { id: "false", label: "Нет" }]}
                  selected={[rule.value]} onPress={(id) => patch({ visibleIf: { ...rule, value: id } })} />
              </> : (
                <TextField label="Значение" value={rule.value} onChangeText={(value) => patch({ visibleIf: { ...rule, value } })} />
              )}
            </> : null}

            {field.type === "NUMBER" ? <>
              <Text style={[styles.group, { color: colors.textPrimary }]}>Ограничения ответа</Text>
              <View style={styles.pair}>
                <View style={styles.optionInput}>
                  <TextField label="Не меньше" keyboardType="decimal-pad" value={limits.min === undefined ? "" : String(limits.min)}
                    onChangeText={(text) => setLimits({ ...limits, min: numberOrUndefined(text) })} />
                </View>
                <View style={styles.optionInput}>
                  <TextField label="Не больше" keyboardType="decimal-pad" value={limits.max === undefined ? "" : String(limits.max)}
                    onChangeText={(text) => setLimits({ ...limits, max: numberOrUndefined(text) })} />
                </View>
              </View>
              <ChoiceGrid group="Целое число" columns={1} items={[{ id: "integer", label: "Только целое" }]}
                selected={limits.integer === true ? ["integer"] : []}
                onPress={() => setLimits({ ...limits, integer: limits.integer === true ? undefined : true })} />
            </> : null}
            {field.type === "SHORT_TEXT" || field.type === "LONG_TEXT" ? <>
              <Text style={[styles.group, { color: colors.textPrimary }]}>Ограничения ответа</Text>
              <TextField label="Не длиннее, символов" keyboardType="number-pad"
                value={limits.maxLength === undefined ? "" : String(limits.maxLength)}
                onChangeText={(text) => setLimits({ ...limits, maxLength: numberOrUndefined(text) })} />
            </> : null}
            {field.type === "DATE" ? <>
              <Text style={[styles.group, { color: colors.textPrimary }]}>Ограничения ответа</Text>
              <ChoiceGrid group="Дата" columns={1} items={[{ id: "notFuture", label: "Не в будущем" }]}
                selected={limits.notFuture === true ? ["notFuture"] : []}
                onPress={() => setLimits({ ...limits, notFuture: limits.notFuture === true ? undefined : true })} />
            </> : null}
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: { flex: 1, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderWidth: 1, overflow: "hidden" },
  header: { minHeight: 52, paddingLeft: 16, paddingRight: 4, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", borderBottomWidth: 1 },
  title: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  body: { padding: 16, gap: 10 },
  issue: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 17 },
  group: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17, marginTop: 6 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  optionRow: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  optionInput: { flex: 1 },
  pair: { flexDirection: "row", gap: 8 },
  add: { minHeight: 40, borderWidth: 1, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  addText: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 17 },
});
