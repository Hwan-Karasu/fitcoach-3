import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, SelectionChip, StatusTag, TextField } from
  "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { APPOINTMENT_DURATIONS, SESSION_TYPE_COLORS, type CalendarSettings, type CategoryPolicy, type SessionType,
  type SessionTypeCategory, type SessionTypeColor } from "../domain/CalendarModel.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { calendarErrorMessage, sessionTypeColorHex } from "./calendarPresentation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const categoryLabel: Readonly<Record<SessionTypeCategory, string>> = {
  TRAINING: "Тренировка", INSTRUCTION: "Инструктаж", CONSULTATION: "Консультация", OTHER: "Другое",
};
const colorLabel: Readonly<Record<SessionTypeColor, string>> = {
  teal: "Бирюзовый", blue: "Синий", violet: "Фиолетовый", amber: "Янтарный", rose: "Розовый", slate: "Графитовый",
};

interface Draft {
  readonly id: string | null;
  readonly name: string;
  readonly category: SessionTypeCategory;
  readonly duration: number;
  readonly requiresCredit: boolean;
  readonly color: SessionTypeColor | null;
  readonly creditLocked: boolean;
}

const emptyDraft: Draft = { id: null, name: "", category: "TRAINING", duration: 60, requiresCredit: false,
  color: null, creditLocked: false };

/**
 * §13.12 Calendar Settings: Session Types (§13.8), Copy/Clear Week categories, the undo prompt and
 * a reset to safe defaults (§13.17). Frequent controls (days, day window) stay on the Calendar.
 */
export function CalendarSettingsScreen({ repository }: Readonly<{ repository: CalendarRepositoryPort }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [types, setTypes] = useState<readonly SessionType[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.all([repository.getSettings(), repository.listSessionTypes()]).then(([nextSettings, nextTypes]) => {
      if (active) { setSettings(nextSettings); setTypes(nextTypes); }
    }, () => { if (active) setError("Настройки календаря не загрузились."); });
    return () => { active = false; };
  }, [repository, tick]);

  useEffect(() => repository.subscribeCommittedChanges(() => setTick((value) => value + 1)), [repository]);

  const run = async (work: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      if (done) setNotice(done);
    } catch (failure) {
      setError(calendarErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  const saveDraft = () => {
    if (draft === null) return;
    const input = { name: draft.name, category: draft.category, defaultDurationMinutes: draft.duration,
      requiresCredit: draft.requiresCredit, color: draft.color };
    const id = draft.id;
    void run(async () => {
      if (id === null) await repository.createSessionType(input);
      else await repository.updateSessionType(id, input);
      setDraft(null);
    }, id === null ? "Тип занятия добавлен." : "Тип занятия сохранён. Уже созданные записи не изменились.");
  };

  const policy = (kind: "copyPolicy" | "clearPolicy", key: keyof CategoryPolicy) => {
    if (settings === null) return;
    const next = { copyPolicy: settings.copyPolicy, clearPolicy: settings.clearPolicy };
    void run(() => repository.updatePolicies({ ...next, [kind]: { ...settings[kind], [key]: !settings[kind][key] } }));
  };

  const active = types.filter((type) => !type.archived);
  const archived = types.filter((type) => type.archived);
  const swatch = (color: SessionTypeColor | null) => (
    <View style={[styles.swatch, { backgroundColor: color === null ? colors.accentFill : sessionTypeColorHex[color] }]} />
  );

  return (
    <PrototypeScreen description="Типы занятий, недельные команды и сброс. Дни недели и рабочее окно меняются прямо в календаре.">
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}

      <SectionHeading>Типы занятий</SectionHeading>
      {active.map((type) => (
        <View key={type.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <View style={styles.cardHead}>
            {swatch(type.color)}
            <Text style={[styles.name, { color: colors.textPrimary }]}>{type.name}</Text>
            {settings?.defaultSessionTypeId === type.id ? <StatusTag kind="success" label="По умолчанию" /> : null}
          </View>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            {`${categoryLabel[type.category]} · ${type.defaultDurationMinutes} мин · ${type.requiresCredit ? "списывает тренировку" : "без списания"}`}
          </Text>
          <View style={styles.actions}>
            <AppButton variant="ghost" label="Изменить" disabled={busy} onPress={() => setDraft({ id: type.id, name: type.name,
              category: type.category, duration: type.defaultDurationMinutes, requiresCredit: type.requiresCredit,
              color: type.color, creditLocked: type.inUse })} />
            {settings?.defaultSessionTypeId !== type.id ? <>
              <AppButton variant="ghost" label="По умолчанию" disabled={busy}
                onPress={() => { void run(() => repository.setDefaultSessionType(type.id), `«${type.name}» — тип по умолчанию.`); }} />
              <AppButton variant="ghost" label="В архив" disabled={busy}
                onPress={() => { void run(() => repository.setSessionTypeArchived(type.id, true), `«${type.name}» в архиве.`); }} />
            </> : null}
          </View>
        </View>
      ))}
      {archived.length > 0 ? <Text style={[styles.detail, { color: colors.textSecondary }]}>В архиве:</Text> : null}
      {archived.map((type) => (
        <View key={type.id} style={[styles.archivedRow, { borderColor: colors.border }]}>
          {swatch(type.color)}
          <Text style={[styles.archivedName, { color: colors.textSecondary }]}>{type.name}</Text>
          <AppButton variant="ghost" label="Вернуть" disabled={busy}
            onPress={() => { void run(() => repository.setSessionTypeArchived(type.id, false), `«${type.name}» снова доступен.`); }} />
        </View>
      ))}

      {draft === null ? (
        <AppButton variant="secondary" label="Добавить тип занятия" disabled={busy} onPress={() => setDraft(emptyDraft)} />
      ) : (
        <View style={[styles.form, { borderColor: colors.accentInk, backgroundColor: colors.surface }]}>
          <SectionHeading>{draft.id === null ? "Новый тип" : "Изменить тип"}</SectionHeading>
          <TextField label="Название" value={draft.name} required placeholder="Например, Растяжка"
            onChangeText={(name) => setDraft({ ...draft, name })} />
          <Text style={[styles.detail, { color: colors.textSecondary }]}>Категория — для статистики, не по названию</Text>
          <View style={styles.chips}>
            {(Object.keys(categoryLabel) as SessionTypeCategory[]).map((category) => (
              <SelectionChip key={category} group="Категория" label={categoryLabel[category]}
                selected={draft.category === category} onPress={() => setDraft({ ...draft, category })} />
            ))}
          </View>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>Длительность по умолчанию</Text>
          <View style={styles.chips}>
            {APPOINTMENT_DURATIONS.map((minutes) => (
              <SelectionChip key={minutes} group="Длительность" label={`${minutes} мин`}
                selected={draft.duration === minutes} onPress={() => setDraft({ ...draft, duration: minutes })} />
            ))}
          </View>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>Цвет в календаре</Text>
          <View style={styles.chips}>
            <Pressable accessibilityRole="radio" accessibilityState={{ selected: draft.color === null }}
              accessibilityLabel="Цвет темы" onPress={() => setDraft({ ...draft, color: null })}
              style={[styles.colorOption, { borderColor: draft.color === null ? colors.textPrimary : colors.border }]}>
              {swatch(null)}
            </Pressable>
            {SESSION_TYPE_COLORS.map((color) => (
              <Pressable key={color} accessibilityRole="radio" accessibilityState={{ selected: draft.color === color }}
                accessibilityLabel={colorLabel[color]} onPress={() => setDraft({ ...draft, color })}
                style={[styles.colorOption, { borderColor: draft.color === color ? colors.textPrimary : colors.border }]}>
                {swatch(color)}
              </Pressable>
            ))}
          </View>
          <SelectionChip group="Учёт" label="Списывает тренировку из пакета" selected={draft.requiresCredit}
            disabled={draft.creditLocked}
            onPress={() => setDraft({ ...draft, requiresCredit: !draft.requiresCredit })} />
          {draft.creditLocked ? <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Тип уже используется в записях, поэтому списание не меняется задним числом. Создайте новый тип, а этот уберите в архив.
          </Text> : null}
          <AppButton label="Сохранить" busy={busy} onPress={saveDraft} />
          <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={() => setDraft(null)} />
        </View>
      )}

      {settings !== null ? <>
        <SectionHeading>Копировать неделю</SectionHeading>
        <View style={styles.chips}>
          <SelectionChip group="Копировать" label="Записи" selected={settings.copyPolicy.appointments} disabled={busy}
            onPress={() => policy("copyPolicy", "appointments")} />
          <SelectionChip group="Копировать" label="Дежурства" selected={settings.copyPolicy.duty} disabled={busy}
            onPress={() => policy("copyPolicy", "duty")} />
          <SelectionChip group="Копировать" label="Блокировки" selected={settings.copyPolicy.blocked} disabled={busy}
            onPress={() => policy("copyPolicy", "blocked")} />
        </View>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>
          При вставке существующая запись всегда остаётся, совпадающая копия пропускается.
        </Text>
        <SectionHeading>Очистить неделю</SectionHeading>
        <View style={styles.chips}>
          <SelectionChip group="Очищать" label="Записи" selected={settings.clearPolicy.appointments} disabled={busy}
            onPress={() => policy("clearPolicy", "appointments")} />
          <SelectionChip group="Очищать" label="Дежурства" selected={settings.clearPolicy.duty} disabled={busy}
            onPress={() => policy("clearPolicy", "duty")} />
          <SelectionChip group="Очищать" label="Блокировки" selected={settings.clearPolicy.blocked} disabled={busy}
            onPress={() => policy("clearPolicy", "blocked")} />
        </View>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>
          Очистка не трогает прошедшие записи и никогда не удаляет карточки клиентов.
        </Text>
        <SectionHeading>После отмены записи</SectionHeading>
        <SelectionChip group="После отмены записи" label="Предлагать «Вернуть» 3 секунды" selected={settings.undoCancelPrompt}
          disabled={busy} onPress={() => { void run(() => repository.setUndoCancelPrompt(!settings.undoCancelPrompt)); }} />
      </> : null}

      <AppButton variant="destructive" label="Сбросить настройки календаря" disabled={busy} onPress={() => setResetting(true)} />
      <ConfirmDialog visible={resetting} confirmBusy={busy} title="Сбросить настройки календаря?"
        description="Копирование и очистка снова включат все категории, тип по умолчанию станет «Персональная тренировка», плашка «Вернуть» снова будет показываться. Записи, дежурства, блокировки, списания и типы занятий не изменятся."
        confirmLabel="Сбросить" onCancel={() => setResetting(false)}
        onConfirm={() => { void run(async () => { await repository.resetSettings(); setResetting(false); }, "Настройки календаря сброшены."); }} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: fonts.bold },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  archivedRow: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 10, paddingLeft: 12 },
  archivedName: { flex: 1, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  form: { borderWidth: 2, borderRadius: 12, padding: 12, gap: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  swatch: { width: 18, height: 18, borderRadius: 9 },
  colorOption: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
});
