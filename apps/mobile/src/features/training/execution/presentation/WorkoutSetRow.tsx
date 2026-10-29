import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Check, Gauge, NotebookPen, Plus, X } from "lucide-react-native";
import { withAlpha } from "../../../../shared/ui/theme/colorAlpha.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { type PlannedExercise, type PlannedSet } from "../../plans/public.ts";
import { DROPS_MAX, EMPTY_VALUES, NOTE_MAX, type ConfirmationMode, type PreviousSet, type SetFact, type SetType, type SetValues, type Side } from "../domain/ExecutionModel.ts";
import { limitHint, previousPlainValues, previousSides, type SetField } from "../domain/ExecutionRules.ts";
import { compactValues, compactWithDrops, fieldNames, parseField, planText, rawOf, rpeTone, sanitizeField,
  setTypeLabels, setTypeTone } from "./setFormat.ts";
import { type SetPatch } from "./useWorkoutDiary.ts";
import { PendingInputWrites } from "../domain/PendingInputWrites.ts";
import { styles } from "./workoutStyles.ts";
import { navigationPerformance } from "../../../../shared/diagnostics/NavigationPerformance.ts";
import { useInputDraft } from "./useInputDraft.ts";

/** Пауза после последнего нажатия, после которой значение ячейки записывается. */
const SAVE_DELAY_MS = 700;

type PendingRegistry = PendingInputWrites;
export type SetTarget = Readonly<{ exercise: PlannedExercise; set: PlannedSet; position: number }>;

/**
 * Ячейка фактического значения: свой текст ввода; запись — через паузу после ввода или при уходе фокуса.
 * Отложенная запись регистрируется, чтобы смена исхода сначала дописала последнее значение (§48.23 п. 5).
 * Кнопка клавиатуры: «Далее» — в соседнюю ячейку строки (повторы → кг), на последней — «Готово».
 */
const ValueCell = forwardRef(function ValueCell({ cellKey, field, value, pending, onNext, onCommit }: Readonly<{
  cellKey: string; field: SetField; value: number | null; pending: PendingRegistry;
  /** Следующая ячейка строки; нет — ячейка последняя. */
  onNext: (() => void) | null;
  onCommit: (value: number | null) => Promise<unknown>;
}>, ref: Ref<TextInput>) {
  navigationPerformance.render("ValueCell");
  useEffect(() => { navigationPerformance.mount("ValueCell"); return () => navigationPerformance.unmount("ValueCell"); }, []);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const raw = rawOf({ ...EMPTY_VALUES, [field]: value }, field);
  const focused = useRef(false);
  const { text, invalid, change } = useInputDraft(cellKey, raw, focused.current || pending.has(cellKey));
  const textRef = useRef(raw);
  const valueRef = useRef(value);
  const commitRef = useRef(onCommit);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  valueRef.current = value;
  commitRef.current = onCommit;

  textRef.current = text;

  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    return pending.flush(cellKey);
  }, [cellKey, pending]);

  useEffect(() => () => { if (pending.has(cellKey)) flush(); }, [cellKey, flush, pending]);

  return (
    <TextInput ref={ref} value={text} placeholder="—" placeholderTextColor={colors.textMuted} selectTextOnFocus
      keyboardType={field === "durationSec" ? "numbers-and-punctuation" : field === "loadGrams" ? "decimal-pad" : "number-pad"}
      accessibilityLabel={fieldNames[field]} accessibilityHint={invalid ? limitHint(field) : undefined}
      returnKeyType={onNext === null ? "done" : "next"} submitBehavior={onNext === null ? "blurAndSubmit" : "submit"}
      onSubmitEditing={() => onNext?.()}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; flush(); }}
      onChangeText={(typed) => {
        const next = sanitizeField(field, typed);
        textRef.current = next;
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = null;
        const parsed = parseField(field, next);
        change(next, parsed === "invalid");
        pending.set(cellKey, async () => {
          if (parsed === "invalid") return false;
          if (parsed === valueRef.current) return true;
          return await commitRef.current(parsed) !== null;
        });
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
      }}
      style={[styles.input, { color: colors.textPrimary, backgroundColor: colors.surface,
        borderColor: invalid ? colors.danger : colors.border }]} />
  );
});

/**
 * Заметка о выполнении упражнения (§48.67): запись через паузу после ввода или при уходе фокуса; отложенная
 * запись дописывается перед сменой исхода, как у значений подходов.
 */
export function NoteField({ noteKey, value, pending, onCommit }: Readonly<{
  noteKey: string; value: string; pending: PendingRegistry; onCommit: (text: string) => Promise<unknown>;
}>) {
  navigationPerformance.render("NoteField");
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const focused = useRef(false);
  const { text, change } = useInputDraft(noteKey, value, focused.current || pending.has(noteKey));
  const [openFor, setOpenFor] = useState({ key: noteKey, open: value !== "" });
  const open = openFor.key === noteKey ? openFor.open || value !== "" : value !== "";
  if (openFor.key !== noteKey) setOpenFor({ key: noteKey, open });
  const setOpen = (next: boolean) => setOpenFor({ key: noteKey, open: next });
  const textRef = useRef(value);
  const valueRef = useRef(value);
  const commitRef = useRef(onCommit);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  valueRef.current = value;
  commitRef.current = onCommit;
  textRef.current = text;
  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    return pending.flush(noteKey);
  }, [noteKey, pending]);
  useEffect(() => () => { if (pending.has(noteKey)) flush(); }, [flush, noteKey, pending]);
  if (!open) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Добавить заметку о выполнении" hitSlop={6}
        onPress={() => setOpen(true)} style={styles.noteAdd}>
        <NotebookPen size={15} color={colors.textSecondary} strokeWidth={1.8} />
        <Text style={[styles.noteAddText, { color: colors.textSecondary }]}>Заметка о выполнении</Text>
      </Pressable>
    );
  }
  return (
    <TextInput value={text} multiline maxLength={NOTE_MAX} placeholder="Как прошло: самочувствие, техника, замены…"
      placeholderTextColor={colors.textMuted} accessibilityLabel="Заметка о выполнении"
      autoFocus={value === "" && text === ""}
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; flush(); if (textRef.current.trim() === "") setOpen(false); }}
      onChangeText={(next) => {
        textRef.current = next;
        change(next);
        if (timer.current !== null) clearTimeout(timer.current);
        pending.set(noteKey, async () => next.trim() === valueRef.current.trim() || await commitRef.current(next) !== null);
        timer.current = setTimeout(flush, SAVE_DELAY_MS);
      }}
      style={[styles.note, { color: colors.textPrimary, backgroundColor: colors.input, borderColor: colors.border }]} />
  );
}

/**
 * Строка подхода. Тип красит строку (разминка — жёлтым, отказ — красным, дроп — синим), номер у рабочих
 * подходов не меняется; под дроп-сетом — строки мини-сетов (§48.60), их состав заморожен, пока подход выполнен.
 */
export const SetRow = memo(function SetRow({ scopeKey, exercise, set, position, number, fact, previous, fields, mode, sided, pending,
  onSave, onToggle, onPickType, onPickRpe }: Readonly<{
  exercise: PlannedExercise; set: PlannedSet; position: number; number: number | null; fact: SetFact | undefined; previous: PreviousSet | undefined;
  scopeKey: string;
  fields: readonly SetField[]; mode: ConfirmationMode;
  /** Одностороннее упражнение: две строки «Л» / «П» со своими значениями и отметками (§48.66, §48.70). */
  sided: boolean;
  pending: PendingRegistry;
  onSave: (target: SetTarget, patch: SetPatch) => Promise<unknown>;
  onToggle: (target: SetTarget, side?: Side) => void;
  onPickType: (target: SetTarget) => void;
  onPickRpe: (target: SetTarget) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  // Цель строки собирается из примитивов и неизменных объектов: пропсы строки стабильны, memo срабатывает.
  navigationPerformance.render("SetRow");
  const target = useMemo<SetTarget>(() => ({ exercise, set, position }), [exercise, set, position]);
  const confirmed = fact?.confirmed === true;
  const type: SetType = fact?.setType ?? "NORMAL";
  const tone = setTypeTone(type, colors);
  const drops = fact?.drops ?? [];
  const marker = number === null ? "Р" : String(number);
  const background = tone !== null ? withAlpha(tone, confirmed ? 0.3 : 0.14)
    : confirmed ? withAlpha(colors.success, 0.14) : colors.surfaceRaised;
  const manualSpacer = mode === "MANUAL" ? <View style={styles.side} /> : null;
  const inputs = useRef(new Map<string, TextInput | null>()).current;
  /** Ячейки одной строки (подход, сторона или мини-сет) с переходом «Далее» слева направо. */
  const cells = (prefix: string, valueOf: (field: SetField) => number | null, commit: (field: SetField, value: number | null) => Promise<unknown>) =>
    fields.map((field, index) => {
      const next = fields[index + 1];
      return (
        <ValueCell key={field} ref={(node) => { inputs.set(`${prefix}:${field}`, node); }} cellKey={`${scopeKey}|${prefix}:${field}`}
          field={field} value={valueOf(field)} pending={pending}
          onNext={next === undefined ? null : () => inputs.get(`${prefix}:${next}`)?.focus()}
          onCommit={(value) => commit(field, value)} />
      );
    });
  // §48.80: одна засчитанная сторона — подход частично выполнен (номер подсвечен наполовину).
  const partial = sided && confirmed && fact?.sides?.left.confirmed !== fact?.sides?.right.confirmed;
  const full = confirmed && !partial;
  const sideRow = (side: Side) => {
    const sideFact = side === "L" ? fact?.sides?.left : fact?.sides?.right;
    const done = sideFact?.confirmed === true;
    return <>
      <Text accessibilityLabel={`${side === "L" ? "Левая" : "Правая"} сторона${done ? ", выполнена" : ""}`}
        style={[styles.sideLabel, { color: done ? colors.success : colors.textSecondary }]}>{side === "L" ? "Л" : "П"}</Text>
      {cells(`${set.id}:${side}`, (field) => sideFact?.values[field] ?? null,
        (field, value) => onSave(target, { side: { side, fields: { [field]: value } } }))}
    </>;
  };
  const sideCheck = (side: Side) => {
    const done = (side === "L" ? fact?.sides?.left.confirmed : fact?.sides?.right.confirmed) === true;
    return (
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: done }} hitSlop={6}
        accessibilityLabel={`${side === "L" ? "Левая" : "Правая"} сторона: ${done ? "снять отметку" : "отметить выполненной"}`}
        onPress={() => onToggle(target, side)}
        style={[styles.check, { borderColor: done ? colors.success : colors.border, backgroundColor: done ? colors.success : colors.surface }]}>
        <Check size={18} color={done ? colors.canvas : colors.border} strokeWidth={2.4} />
      </Pressable>
    );
  };
  const sidesPrevious = sided && previous !== undefined ? previousSides(previous) : null;
  const sideText = (value: SetValues | null | undefined) => value === null || value === undefined ? "—" : compactValues(value, fields);
  const previousText = previous === undefined ? "—" : sided
    ? `Л ${sideText(sidesPrevious?.left)}`
    : previous.sides !== null ? compactValues(previousPlainValues(previous), fields)
      : compactWithDrops(previous.values, previous.drops, fields);
  /** Плашка «Пред.» — нажатие переносит прошлый результат в эту ячейку (подход, сторону или мини-сет). */
  const previousChip = (text: string, label: string, onTransfer: (() => void) | null) => (
    <Pressable accessibilityRole="button" disabled={onTransfer === null} hitSlop={6}
      style={({ pressed }) => [styles.previous, onTransfer === null ? null : [styles.previousChip, {
        borderColor: withAlpha(colors.accentInk, 0.45), backgroundColor: withAlpha(colors.accentInk, pressed ? 0.22 : 0.1) }]]}
      accessibilityLabel={onTransfer === null ? "Прошлого результата нет" : `${label} ${text}`}
      onPress={() => onTransfer?.()}>
      <Text style={[styles.previousText, { color: onTransfer === null ? colors.textMuted : colors.accentInk }]} numberOfLines={1}
        adjustsFontSizeToFit minimumFontScale={0.85}>
        {text}
      </Text>
    </Pressable>
  );
  return (
    <View style={[styles.block, { backgroundColor: background }]}>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" hitSlop={6} onPress={() => onPickType(target)}
          accessibilityLabel={`Подход ${marker}, ${setTypeLabels[type].toLowerCase()}${full ? ", выполнен" : partial ? ", выполнен частично" : ""}. Сменить тип`}
          style={[styles.marker, { borderColor: confirmed ? colors.success : tone ?? colors.border,
            backgroundColor: full ? colors.success : partial ? withAlpha(colors.success, 0.35) : colors.surface }]}>
          <Text style={[styles.markerText, { color: full ? colors.canvas : tone ?? colors.textPrimary }]}>{marker}</Text>
        </Pressable>
        <Text style={[styles.plan, { color: colors.textSecondary }]} numberOfLines={1}>{number === null ? "—" : planText(set, fields)}</Text>
        {/* «Пред.» — кнопка-плашка (UI-OWN-037): нажатие переносит прошлый результат в подход; у сторон и мини-сетов — своя плашка. */}
        {previousChip(previousText, "Перенести прошлый результат", previous === undefined || (sided && !sidesPrevious?.left) ? null : () => {
          if (sided) { onSave(target, { sidesFrom: { left: sidesPrevious!.left, right: null } }); return; }
          const values = previousPlainValues(previous);
          onSave(target, type === "DROP" && previous.sides === null ? { fields: values, drops: previous.drops } : { fields: values });
        })}
        {sided ? sideRow("L") : cells(set.id, (field) => fact?.values[field] ?? null,
          (field, value) => onSave(target, { fields: { [field]: value } }))}
        <Pressable accessibilityRole="button" accessibilityLabel={fact?.rpe ? `RPE ${fact.rpe}. Изменить` : "Указать RPE"} hitSlop={6}
          onPress={() => onPickRpe(target)} style={styles.side}>
          {fact?.rpe ? <Text style={[styles.rpeText, { color: rpeTone(fact.rpe, colors) }]}>{fact.rpe}</Text>
            : <Gauge size={20} color={colors.textMuted} strokeWidth={1.8} />}
        </Pressable>
        {mode === "MANUAL" && sided ? sideCheck("L") : null}
        {mode === "MANUAL" && !sided ? (
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: confirmed }}
            accessibilityLabel={confirmed ? "Снять отметку выполнения" : "Отметить подход выполненным"} hitSlop={6}
            onPress={() => onToggle(target)}
            style={[styles.check, { borderColor: confirmed ? colors.success : colors.border,
              backgroundColor: confirmed ? colors.success : colors.surface }]}>
            <Check size={18} color={confirmed ? colors.canvas : colors.border} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
      {sided ? (
        <View style={styles.row}>
          <View style={styles.markerSpace} />
          <View style={styles.plan} />
          {previousChip(`П ${sideText(sidesPrevious?.right)}`, "Перенести прошлый результат правой стороны",
            sidesPrevious?.right ? () => onSave(target, { sidesFrom: { left: null, right: sidesPrevious.right } }) : null)}
          {sideRow("R")}
          <View style={styles.side} />
          {mode === "MANUAL" ? sideCheck("R") : null}
        </View>
      ) : null}
      {type === "DROP" ? <>
        {drops.map((drop, index) => (
          <View key={`drop-${index}`} style={styles.row}>
            <View style={styles.markerSpace} />
            <View style={styles.plan} />
            {previousChip(`↳ ${index + 2}  ${previous?.drops[index] === undefined ? "—" : compactValues(previous.drops[index]!, fields)}`,
              `Перенести прошлый мини-сет ${index + 2}`,
              previous?.drops[index] === undefined ? null : () => onSave(target, { drop: { index, fields: previous.drops[index]! } }))}
            {cells(`${set.id}:d${index}`, (field) => drop[field],
              (field, value) => onSave(target, { drop: { index, fields: { [field]: value } } }))}
            <Pressable accessibilityRole="button" accessibilityLabel={`Убрать мини-сет ${index + 2}`} hitSlop={6}
              disabled={confirmed || drops.length <= 1} style={[styles.side, (confirmed || drops.length <= 1) && styles.dim]}
              onPress={() => onSave(target, { drops: drops.filter((_, item) => item !== index) })}>
              <X size={18} color={colors.danger} strokeWidth={2} />
            </Pressable>
            {manualSpacer}
          </View>
        ))}
        <View style={styles.row}>
          <View style={styles.markerSpace} />
          <Pressable accessibilityRole="button" disabled={confirmed || drops.length >= DROPS_MAX}
            accessibilityLabel="Добавить мини-сет"
            accessibilityHint={confirmed ? "Подход выполнен — сначала снимите выполнение" : undefined}
            onPress={() => onSave(target, { drops: [...drops, EMPTY_VALUES] })}
            style={[styles.addDrop, { borderColor: tone ?? colors.border }, (confirmed || drops.length >= DROPS_MAX) && styles.dim]}>
            <Plus size={16} color={colors.accentInk} strokeWidth={2.2} />
            <Text style={[styles.addDropText, { color: colors.accentInk }]}>Мини-сет</Text>
          </Pressable>
        </View>
      </> : null}
    </View>
  );
});
