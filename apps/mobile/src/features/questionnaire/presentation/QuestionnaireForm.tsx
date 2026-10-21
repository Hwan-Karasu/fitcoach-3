import { StyleSheet, Text, View } from "react-native";
import { ChoiceGrid, DateField, TextField } from "../../../shared/ui/components/public.ts";
import { choiceColumns } from "./choiceLayout.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { AnswerValue, Answers, QuestionField, QuestionnaireSchema } from "../domain/QuestionnaireModel.ts";
import { formatDateInput, isFieldVisible, parseDateInput, parseNumberInput } from "../domain/QuestionnaireRules.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

/** What the trainer is typing: numbers and dates stay text until they are checked. */
export type InputValue = string | boolean | readonly string[] | undefined;
export type FormInputs = Readonly<Record<string, InputValue>>;

export function inputFromAnswer(target: QuestionField, value: AnswerValue | undefined): InputValue {
  if (value === undefined) return undefined;
  if (typeof value === "number") return String(value).replace(".", ",");
  if (target.type === "DATE" && typeof value === "string") return formatDateInput(value);
  return value;
}

/** The raw answer for validation, or a marker when number/date text does not parse. */
export function answerFromInput(target: QuestionField, input: InputValue): unknown {
  if (input === undefined) return null;
  if (target.type === "NUMBER" && typeof input === "string") {
    const parsed = parseNumberInput(input);
    return parsed === "invalid" ? input : parsed;
  }
  if (target.type === "DATE" && typeof input === "string") {
    const parsed = parseDateInput(input);
    return parsed === "invalid" ? "invalid-date" : parsed;
  }
  return input;
}

/** Valid parsed answers only, for live conditional visibility while typing. */
export function answersFromInputs(schema: QuestionnaireSchema, inputs: FormInputs): Answers {
  const result: Record<string, AnswerValue> = {};
  for (const item of schema.sections) {
    for (const entry of item.fields) {
      const raw = answerFromInput(entry, inputs[entry.id]);
      if (raw === null || raw === "invalid-date" || (entry.type === "NUMBER" && typeof raw === "string")) continue;
      result[entry.id] = raw as AnswerValue;
    }
  }
  return result;
}

const requiredNote = "* Обязательно для завершения анкеты. Карточку клиента можно сохранить и заполнить позже.";

/**
 * The canonical Questionnaire renderer (§23.1): the client form and the builder Preview use the
 * same component. Only applicable questions are shown; hidden answers stay in `inputs`.
 */
export function QuestionnaireForm({ schema, inputs, errors, onChange, disabled = false, onSectionLayout }: Readonly<{
  schema: QuestionnaireSchema;
  inputs: FormInputs;
  errors: Readonly<Record<string, string>>;
  onChange: (fieldId: string, value: InputValue) => void;
  disabled?: boolean;
  /** Положение раздела внутри формы — для перехода к нему вкладками единой карточки клиента. */
  onSectionLayout?: (sectionId: string, y: number) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const answers = answersFromInputs(schema, inputs);
  const hasRequired = schema.sections.some((item) => item.fields.some((entry) => entry.required));

  const renderField = (entry: QuestionField) => {
    const value = inputs[entry.id];
    const label = `${entry.label}${entry.required ? " *" : ""}`;
    const error = errors[entry.id];
    const help = entry.help === null ? null : <Text style={[styles.help, { color: colors.textSecondary }]}>{entry.help}</Text>;
    const problem = error === undefined ? null : <Text style={[styles.error, { color: colors.danger }]}>{error}</Text>;
    if (entry.type === "DATE") {
      const parsed = typeof value === "string" ? parseDateInput(value) : null;
      return (
        <View key={entry.id} style={styles.field}>
          <DateField label={label} value={typeof parsed === "string" ? parsed : ""} disabled={disabled} hint={entry.help ?? undefined}
            max={entry.constraints?.notFuture === true ? new Date().toISOString().slice(0, 10) : undefined}
            error={error} onChange={(iso) => onChange(entry.id, iso === "" ? undefined : formatDateInput(iso))} />
        </View>
      );
    }
    if (entry.type === "SHORT_TEXT" || entry.type === "LONG_TEXT" || entry.type === "NUMBER") {
      return (
        <View key={entry.id} style={styles.field}>
          <TextField label={label} value={typeof value === "string" ? value : ""} disabled={disabled}
            keyboardType={entry.type === "NUMBER" ? "decimal-pad" : undefined}
            placeholder={entry.type === "NUMBER" ? "Число" : entry.help ?? undefined}
            hint={entry.type === "NUMBER" ? entry.help ?? undefined : undefined}
            error={error} onChangeText={(text) => onChange(entry.id, text)} />
        </View>
      );
    }
    if (entry.type === "SWITCH") {
      return (
        <View key={entry.id} style={styles.field}>
          <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
          {help}
          <ChoiceGrid group={entry.label} columns={2} disabled={disabled}
            items={[{ id: "yes", label: "Да" }, { id: "no", label: "Нет" }]}
            selected={value === true ? ["yes"] : value === false ? ["no"] : []}
            onPress={(id) => onChange(entry.id, id === "yes" ? (value === true ? undefined : true) : (value === false ? undefined : false))} />
          {problem}
        </View>
      );
    }
    const selected = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    // A retired option stays visible only where it is the saved answer (§25.12).
    const options = entry.options.filter((option) => !option.retired || selected.includes(option.id));
    return (
      <View key={entry.id} style={styles.field}>
        <Text style={[styles.label, { color: colors.textPrimary }]}>{label}</Text>
        {help}
        {entry.type === "MULTI_CHOICE" ? <Text style={[styles.help, { color: colors.textMuted }]}>Можно выбрать несколько</Text> : null}
        <ChoiceGrid group={entry.label} disabled={disabled} selected={selected}
          columns={choiceColumns(options.map((option) => option.label))}
          items={options.map((option) => ({ id: option.id, label: option.retired ? `${option.label} (больше не предлагается)` : option.label }))}
          onPress={(id) => {
            if (entry.type === "SINGLE_CHOICE") onChange(entry.id, selected.includes(id) ? undefined : id);
            else {
              const next = selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id];
              onChange(entry.id, next.length === 0 ? undefined : next);
            }
          }} />
        {problem}
      </View>
    );
  };

  return (
    <View style={styles.form}>
      {hasRequired ? <Text style={[styles.help, { color: colors.textSecondary }]}>{requiredNote}</Text> : null}
      {schema.sections.filter((item) => !item.hidden).map((item) => {
        const visible = item.fields.filter((entry) => isFieldVisible(schema, entry.id, answers));
        if (visible.length === 0) return null;
        return (
          <View key={item.id} style={[styles.section, { borderColor: colors.border, backgroundColor: colors.surface }]}
            onLayout={onSectionLayout === undefined ? undefined : (event) => onSectionLayout(item.id, event.nativeEvent.layout.y)}>
            <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.textPrimary }]}>{item.title}</Text>
            {item.help !== null ? <Text style={[styles.help, { color: colors.textSecondary }]}>{item.help}</Text> : null}
            {visible.map(renderField)}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 12 },
  section: { borderWidth: 1, borderRadius: 14, padding: 14, gap: 14 },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontFamily: fonts.bold },
  field: { gap: 6 },
  label: { fontSize: 14, lineHeight: 19, fontFamily: fonts.semibold },
  help: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  error: { fontSize: 12, lineHeight: 16, fontFamily: fonts.semibold },
});
