import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, LoadingState, SelectionChip, StatusTag,
  TextField } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { MEASUREMENT_TYPES, type ClientMeasurements, type Measurement, type MeasurementType } from
  "../domain/MeasurementModel.ts";
import type { MeasurementRepositoryPort } from "../domain/MeasurementRepositoryPort.ts";
import { addDays, dailyPoints, formatDate, formatTime, formatValue, latestPoint, localDateOf,
  measurementTypeInfo, parseTime, parseValueX10 } from "../domain/MeasurementRules.ts";

function entries(count: number): string {
  const tail = count % 100;
  if (tail >= 11 && tail <= 14) return `${count} замеров`;
  if (count % 10 === 1) return `${count} замер`;
  return count % 10 >= 2 && count % 10 <= 4 ? `${count} замера` : `${count} замеров`;
}

function errorMessage(error: unknown): string {
  switch (error instanceof Error ? error.message : "") {
    case "MEASUREMENT_VALUE_INVALID": return "Проверьте значение: оно вне допустимого диапазона для этого показателя.";
    case "MEASUREMENT_DATE_INVALID": return "Замер не может быть в будущем.";
    case "MEASUREMENT_TIME_INVALID": return "Время — в формате ЧЧ:ММ.";
    case "MEASUREMENT_STALE": return "Замер уже изменился. Список обновлён, повторите действие.";
    default: return "Не удалось сохранить. Замеры не изменены.";
  }
}

interface Draft {
  readonly editing: Measurement | null;
  readonly type: MeasurementType;
  readonly value: string;
  readonly date: string;
  readonly time: string;
}

function freshDraft(type: MeasurementType = "WEIGHT"): Draft {
  const now = new Date();
  return { editing: null, type, value: "", date: localDateOf(now), time: formatTime(now.getHours() * 60 + now.getMinutes()) };
}

/**
 * §§49.14–49.18: one journal of facts per client. Several entries a day are kept; the daily graph
 * value is the chosen primary or the only entry, otherwise the trainer is asked to choose one.
 */
export function ClientMeasurementsScreen({ clientId, repository }: Readonly<{
  clientId: string; repository: MeasurementRepositoryPort;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [data, setData] = useState<ClientMeasurements | null>(null);
  const [failed, setFailed] = useState(false);
  const [tick, setTick] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Measurement | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => repository.listForClient(clientId)).then((next) => {
      if (active) { setData(next); setFailed(false); }
    }, () => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [clientId, repository, tick]);

  useEffect(() => repository.subscribeCommittedChanges((change) => {
    if (change.clientId === clientId) setTick((value) => value + 1);
  }), [clientId, repository]);

  const days = useMemo(() => {
    const groups = new Map<string, Measurement[]>();
    for (const row of data?.measurements ?? []) groups.set(row.localDate, [...(groups.get(row.localDate) ?? []), row]);
    return [...groups.entries()];
  }, [data]);

  if (data === null) {
    return <PrototypeScreen>
      {failed ? <InlineNotice kind="error">Замеры не загрузились.</InlineNotice> : <LoadingState label="Загружаем замеры…" />}
      {failed ? <AppButton label="Повторить" onPress={() => setTick((value) => value + 1)} /> : null}
    </PrototypeScreen>;
  }

  const primaryIds = new Set(data.primaries.map((entry) => entry.measurementId));
  const run = async (work: () => Promise<unknown>, after?: () => void) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await work();
      after?.();
    } catch (failure) {
      setError(errorMessage(failure));
      setTick((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (draft === null) return;
    const valueX10 = parseValueX10(draft.value);
    const minute = parseTime(draft.time);
    if (valueX10 === null) { setError("Введите значение, например 80,1."); return; }
    if (minute === "invalid") { setError(errorMessage(new Error("MEASUREMENT_TIME_INVALID"))); return; }
    const input = { type: draft.type, valueX10, localDate: draft.date, localMinute: minute };
    const editing = draft.editing;
    void run(() => editing === null ? repository.record(clientId, input)
      : repository.correct(editing.id, editing.revision, input), () => setDraft(null));
  };

  return (
    <PrototypeScreen description="Масса, процент жира и обхваты. Отсутствующий замер — «нет данных», не ноль.">
      <SectionHeading>Последние значения</SectionHeading>
      <View style={styles.summary}>
        {MEASUREMENT_TYPES.map((type) => {
          const point = latestPoint(data.measurements, data.primaries, type);
          return (
            <View key={type} style={styles.summaryRow}>
              <Text style={[styles.summaryLabel, { color: colors.textSecondary }]}>{measurementTypeInfo[type].label}</Text>
              <Text style={[styles.summaryValue, { color: point === null ? colors.textSecondary : colors.textPrimary }]}>
                {point === null ? "нет данных" : point.kind === "VALUE"
                  ? `${formatValue(point.measurement.valueX10, type)} · ${formatDate(point.localDate)}`
                  : `${entries(point.candidates.length)} ${formatDate(point.localDate)} — выберите основной`}
              </Text>
            </View>
          );
        })}
      </View>

      {draft === null ? (
        <AppButton label="Добавить замер" onPress={() => { setError(null); setDraft(freshDraft()); }} />
      ) : (
        <View style={[styles.form, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <SectionHeading>{draft.editing === null ? "Новый замер" : "Исправить замер"}</SectionHeading>
          <View style={styles.chips}>
            {MEASUREMENT_TYPES.map((type) => (
              <SelectionChip key={type} group="Показатель" label={measurementTypeInfo[type].label}
                selected={draft.type === type} onPress={() => setDraft({ ...draft, type })} />
            ))}
          </View>
          <TextField label={`Значение, ${measurementTypeInfo[draft.type].unit}`} value={draft.value} required
            keyboardType="decimal-pad" placeholder="Например, 80,1"
            onChangeText={(value) => setDraft({ ...draft, value })} />
          <View style={styles.stepper}>
            <AppButton variant="ghost" label="‹" accessibilityLabel="Предыдущий день"
              onPress={() => setDraft({ ...draft, date: addDays(draft.date, -1) })} />
            <Text style={[styles.stepperValue, { color: colors.textPrimary }]}>{formatDate(draft.date)}</Text>
            <AppButton variant="ghost" label="›" accessibilityLabel="Следующий день"
              disabled={draft.date >= localDateOf(new Date())}
              onPress={() => setDraft({ ...draft, date: addDays(draft.date, 1) })} />
          </View>
          <TextField label="Время" value={draft.time} placeholder="ЧЧ:ММ"
            hint="Оставьте пустым, если известна только дата."
            onChangeText={(time) => setDraft({ ...draft, time })} />
          <AppButton label={draft.editing === null ? "Сохранить замер" : "Сохранить исправление"} busy={busy}
            onPress={save} />
          <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={() => { setDraft(null); setError(null); }} />
        </View>
      )}
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}

      <SectionHeading>Журнал замеров</SectionHeading>
      {days.length === 0 ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>Замеров пока нет.</Text>
      ) : days.map(([date, rows]) => (
        <View key={date} style={styles.day}>
          <Text style={[styles.dayTitle, { color: colors.textPrimary }]}>{formatDate(date)}</Text>
          {MEASUREMENT_TYPES.filter((type) => dailyPoints(rows, data.primaries, type)[0]?.kind === "AMBIGUOUS").map((type) => (
            <Text key={type} style={[styles.hint, { color: colors.warning }]}>
              {measurementTypeInfo[type].label}: несколько замеров за день — выберите основной для графика.
            </Text>
          ))}
          {rows.map((row) => {
            const sameDay = rows.filter((other) => other.type === row.type).length;
            return (
              <View key={row.id} style={[styles.entry, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <View style={styles.entryHead}>
                  <Text style={[styles.entryText, { color: colors.textPrimary }]}>
                    {measurementTypeInfo[row.type].label} · {formatValue(row.valueX10, row.type)}
                  </Text>
                  {primaryIds.has(row.id) ? <StatusTag kind="success" label="Основной" /> : null}
                </View>
                <Text style={[styles.hint, { color: colors.textSecondary }]}>
                  {formatTime(row.localMinute)}{row.method === "NAVY_ESTIMATE" ? " · оценка по окружностям (ВМС США)" : ""}
                </Text>
                <View style={styles.actions}>
                  {sameDay > 1 && !primaryIds.has(row.id) ? (
                    <AppButton variant="secondary" label="Сделать основным" disabled={busy}
                      onPress={() => { void run(() => repository.setPrimary(row.id)); }} />
                  ) : null}
                  <AppButton variant="ghost" label="Исправить" disabled={busy} onPress={() => {
                    setError(null);
                    setDraft({ editing: row, type: row.type, value: formatValue(row.valueX10, row.type).split(" ")[0] ?? "",
                      date: row.localDate, time: row.localMinute === null ? "" : formatTime(row.localMinute) });
                  }} />
                  <AppButton variant="ghost" label="Удалить" disabled={busy} onPress={() => setDeleting(row)} />
                </View>
              </View>
            );
          })}
        </View>
      ))}
      <ConfirmDialog visible={deleting !== null} destructive confirmBusy={busy} title="Удалить замер?"
        description={deleting === null ? "" : `${measurementTypeInfo[deleting.type].label} ${formatValue(deleting.valueX10,
          deleting.type)}, ${formatDate(deleting.localDate)}, ${formatTime(deleting.localMinute)}. Другие замеры этого дня останутся.`}
        confirmLabel="Удалить" onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const row = deleting;
          if (row !== null) void run(() => repository.remove(row.id, row.revision), () => setDeleting(null));
        }} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  summary: { gap: 6 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  summaryLabel: { fontSize: 14, lineHeight: 20 },
  summaryValue: { flexShrink: 1, textAlign: "right", fontSize: 14, lineHeight: 20, fontWeight: "700" },
  form: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  stepperValue: { flex: 1, textAlign: "center", fontSize: 16, lineHeight: 22, fontWeight: "700" },
  day: { gap: 8 },
  dayTitle: { fontSize: 16, lineHeight: 22, fontWeight: "700" },
  entry: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  entryHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  entryText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  hint: { fontSize: 13, lineHeight: 18 },
});
