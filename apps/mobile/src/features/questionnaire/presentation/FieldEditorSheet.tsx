import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowDown, ArrowUp, Plus, RotateCcw, X } from "lucide-react-native";
import { AppIconButton, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { addOption, canChangeType, CHOICE_TYPES, locateField, moveOption, removeOption, renameOption, restoreOption,
  updateField } from "../domain/QuestionnaireBuilder.ts";
import { QUESTION_TYPES, type FieldConstraints, type QuestionField, type QuestionnaireSchema,
  type QuestionType, type VisibilityRule } from "../domain/QuestionnaireModel.ts";
import { allFields, validateSchema } from "../domain/QuestionnaireRules.ts";

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
export function FieldEditorSheet({ schema, published, fieldId, apply, newId, onClose }: Readonly<{
  schema: QuestionnaireSchema;
  published: QuestionnaireSchema;
  fieldId: string | null;
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
  const issues = field === null ? [] : validateSchema(schema).filter((issue) => issue.fieldId === field.id);
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
            <TextField label="Текст вопроса" required value={field.label} onChangeText={(label) => patch({ label })} />
            <TextField label="Подсказка · необязательно" value={field.help ?? ""}
              onChangeText={(help) => patch({ help: help.trim() === "" ? null : help })} />

            <Text style={[styles.group, { color: colors.textPrimary }]}>Обязательный для завершения анкеты</Text>
            <View style={styles.chips}>
              <SelectionChip group="Обязательный" label="Да" selected={field.required} onPress={() => patch({ required: true })} />
              <SelectionChip group="Обязательный" label="Нет" selected={!field.required} onPress={() => patch({ required: false })} />
            </View>

            <Text style={[styles.group, { color: colors.textPrimary }]}>Тип ответа</Text>
            {canChangeType(field, published) ? (
              <View style={styles.chips}>
                {QUESTION_TYPES.map((type) => (
                  <SelectionChip key={type} group="Тип ответа" label={typeLabels[type]} selected={field.type === type}
                    onPress={() => patch({ type })} />
                ))}
              </View>
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

            <Text style={[styles.group, { color: colors.textPrimary }]}>Показывать вопрос</Text>
            <View style={styles.chips}>
              <SelectionChip group="Показывать" label="Всегда" selected={rule === null} onPress={() => patch({ visibleIf: null })} />
              {sources.map((entry) => (
                <SelectionChip key={entry.id} group="Показывать, если" label={entry.label.trim() || "Без текста"}
                  selected={rule?.sourceFieldId === entry.id}
                  onPress={() => patch({ visibleIf: { sourceFieldId: entry.id, operator: "EQUALS",
                    value: entry.type === "SWITCH" ? "true" : entry.options.find((option) => !option.retired)?.id ?? "" } })} />
              ))}
            </View>
            {rule !== null && source !== null ? <>
              <View style={styles.chips}>
                {operatorsFor(source.type).map((operator) => (
                  <SelectionChip key={operator} group="Условие" label={operatorLabels[operator]} selected={rule.operator === operator}
                    onPress={() => patch({ visibleIf: { ...rule, operator } })} />
                ))}
              </View>
              {CHOICE_TYPES.includes(source.type) ? (
                <View style={styles.chips}>
                  {source.options.filter((option) => !option.retired).map((option) => (
                    <SelectionChip key={option.id} group="Значение" label={option.label || "Без текста"} selected={rule.value === option.id}
                      onPress={() => patch({ visibleIf: { ...rule, value: option.id } })} />
                  ))}
                </View>
              ) : source.type === "SWITCH" ? (
                <View style={styles.chips}>
                  <SelectionChip group="Значение" label="Да" selected={rule.value === "true"} onPress={() => patch({ visibleIf: { ...rule, value: "true" } })} />
                  <SelectionChip group="Значение" label="Нет" selected={rule.value === "false"} onPress={() => patch({ visibleIf: { ...rule, value: "false" } })} />
                </View>
              ) : (
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
              <View style={styles.chips}>
                <SelectionChip group="Целое число" label="Только целое" selected={limits.integer === true}
                  onPress={() => setLimits({ ...limits, integer: limits.integer === true ? undefined : true })} />
              </View>
            </> : null}
            {field.type === "SHORT_TEXT" || field.type === "LONG_TEXT" ? <>
              <Text style={[styles.group, { color: colors.textPrimary }]}>Ограничения ответа</Text>
              <TextField label="Не длиннее, символов" keyboardType="number-pad"
                value={limits.maxLength === undefined ? "" : String(limits.maxLength)}
                onChangeText={(text) => setLimits({ ...limits, maxLength: numberOrUndefined(text) })} />
            </> : null}
            {field.type === "DATE" ? <>
              <Text style={[styles.group, { color: colors.textPrimary }]}>Ограничения ответа</Text>
              <View style={styles.chips}>
                <SelectionChip group="Дата" label="Не в будущем" selected={limits.notFuture === true}
                  onPress={() => setLimits({ ...limits, notFuture: limits.notFuture === true ? undefined : true })} />
              </View>
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
  title: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { padding: 16, gap: 10 },
  issue: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  group: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 19, marginTop: 6 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  optionRow: { flexDirection: "row", alignItems: "flex-end", gap: 2 },
  optionInput: { flex: 1 },
  pair: { flexDirection: "row", gap: 8 },
  add: { minHeight: 40, borderWidth: 1, borderRadius: 8, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  addText: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 19 },
});
