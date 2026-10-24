import { Fragment, useEffect, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { X } from "lucide-react-native";
import { AppButton, ConfirmDialog, InlineNotice, SelectionChip, StatusTag } from
  "../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { type CalendarSettings, type CategoryPolicy, type SessionType, type SessionTypeColor } from "../domain/CalendarModel.ts";
import type { CalendarRepositoryPort } from "../domain/CalendarRepositoryPort.ts";
import { calendarErrorMessage, sessionTypeColorHex } from "./calendarPresentation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { SessionTypeEditor, sessionCategoryLabels as categoryLabel, type SessionTypeDraft as Draft } from "./SessionTypeEditor.tsx";
import { DEFAULT_DUTY_COLOR, resolveDutyColor, resolveTypeColors, sessionTypeColorLabels } from "./calendarTypeColors.ts";

const emptyDraft: Draft = { id: null, name: "", category: "TRAINING", duration: 60, requiresCredit: false,
  color: null, creditLocked: false };

function TypeAction({ label, disabled, onPress }: Readonly<{ label: string; disabled: boolean; onPress: () => void }>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  const [focused, setFocused] = useState(false);
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
    disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={({ pressed }) => [styles.typeAction, { borderColor: focused ? colors.focusRing : "transparent",
      backgroundColor: pressed ? colors.accentSoft : "transparent", opacity: disabled ? 0.5 : 1 }]}>
    <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.typeActionLabel, { color: colors.accentInk }]}>{label}</Text>
  </Pressable>;
}

/**
 * §13.12 Calendar Settings: Session Types (§13.8), Copy/Clear Week categories, the undo prompt and
 * a reset to safe defaults (§13.17). Frequent controls (days, day window) stay on the Calendar.
 */
export function CalendarSettingsScreen({ repository }: Readonly<{ repository: CalendarRepositoryPort }>) {
  const { palette, dutyColor, setDutyColor, hiddenSessionTypeIds, hideSessionType } = usePrototypeTheme();
  const colors = palette.tokens;
  const [settings, setSettings] = useState<CalendarSettings | null>(null);
  const [types, setTypes] = useState<readonly SessionType[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [deleting, setDeleting] = useState<SessionType | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [dutyDraft, setDutyDraft] = useState<{ color: string | null } | null>(null);
  const [tick, setTick] = useState(0);
  const effectiveDutyColor = resolveDutyColor(dutyColor);
  const typeColors = resolveTypeColors(types, effectiveDutyColor);
  const occupiedColors = new Set([effectiveDutyColor, ...types.filter((type) => !type.archived && type.id !== draft?.id)
    .flatMap((type) => { const color = typeColors.get(type.id); return color === undefined ? [] : [sessionTypeColorHex[color]]; })]);

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
    if (draft.color === null || occupiedColors.has(sessionTypeColorHex[draft.color])) {
      setError("Выберите свободный цвет. Один цвет нельзя назначить разным типам.");
      return;
    }
    const input = { name: draft.name, category: draft.category, defaultDurationMinutes: draft.duration,
      requiresCredit: draft.requiresCredit, color: draft.color };
    const id = draft.id;
    void run(async () => {
      await stabilizeTypeColors(id);
      if (id === null) await repository.createSessionType(input);
      else await repository.updateSessionType(id, input);
      setDraft(null);
    }, id === null ? "Тип занятия добавлен." : "Тип занятия сохранён. Цвет обновлён и у существующих записей.");
  };

  const stabilizeTypeColors = async (exceptId: string | null = null) => {
    for (const type of types) {
      const color = typeColors.get(type.id);
      if (type.id === exceptId || type.archived || color === undefined || type.color === color) continue;
      await repository.updateSessionType(type.id, { name: type.name, category: type.category,
        defaultDurationMinutes: type.defaultDurationMinutes, requiresCredit: type.requiresCredit, color });
    }
  };

  const policy = (kind: "copyPolicy" | "clearPolicy", key: keyof CategoryPolicy) => {
    if (settings === null) return;
    const next = { copyPolicy: settings.copyPolicy, clearPolicy: settings.clearPolicy };
    void run(() => repository.updatePolicies({ ...next, [kind]: { ...settings[kind], [key]: !settings[kind][key] } }));
  };

  const active = types.filter((type) => !type.archived);
  const openDraft = (value: Draft) => {
    const occupied = new Set([effectiveDutyColor, ...active.filter((type) => type.id !== value.id)
      .flatMap((type) => { const color = typeColors.get(type.id); return color === undefined ? [] : [sessionTypeColorHex[color]]; })]);
    const color = value.id === null ? (Object.keys(sessionTypeColorHex) as SessionTypeColor[])
      .find((candidate) => !occupied.has(sessionTypeColorHex[candidate])) : typeColors.get(value.id);
    if (color === undefined) { setError("Все цвета заняты. Освободите цвет, убрав ненужный тип в архив."); return; }
    setError(null); setDraft({ ...value, color });
  };
  const archived = types.filter((type) => type.archived && !hiddenSessionTypeIds.includes(type.id));
  const requestDelete = (type: SessionType) => {
    if (busy) return;
    if (settings?.defaultSessionTypeId === type.id) {
      Alert.alert("Тип по умолчанию", calendarErrorMessage(new Error("CALENDAR_DEFAULT_TYPE_DELETE")));
      return;
    }
    setDeleteError(null);
    setDeleting(type);
  };
  const deleteType = async () => {
    if (busy || deleting === null) return;
    setBusy(true);
    setDeleteError(null);
    try {
      await repository.setSessionTypeArchived(deleting.id, true);
      hideSessionType(deleting.id);
      setNotice(`«${deleting.name}» удалён из списка. История сохранена.`);
      setDeleting(null);
    } catch (failure) { setDeleteError(calendarErrorMessage(failure)); }
    finally { setBusy(false); }
  };
  const deleteButton = (type: SessionType) => <Pressable accessibilityRole="button"
    accessibilityLabel={`Удалить тип занятия ${type.name}`} accessibilityState={{ disabled: busy }} disabled={busy}
    testID={`delete-session-type-${type.id}`} onPress={() => requestDelete(type)}
    style={({ pressed }) => [styles.deleteButton, { backgroundColor: pressed ? colors.surfaceRaised : "transparent", opacity: busy ? 0.5 : 1 }]}>
    <X size={17} color={colors.danger} strokeWidth={2.3} />
  </Pressable>;
  const swatch = (color: SessionTypeColor | null) => (
    <View style={[styles.swatch, { backgroundColor: color === null ? colors.accentFill : sessionTypeColorHex[color] }]} />
  );
  const dutyAfterId = (active.find((type) => type.name === "Персональная тренировка") ?? active[0])?.id;
  const dutyCard = <View style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
    <View style={styles.cardHead}>
      <View style={[styles.swatch, { backgroundColor: effectiveDutyColor }]} />
      <Text style={[styles.name, { color: colors.textPrimary }]}>Дежурство</Text>
      <StatusTag kind="success" label="Встроенный" />
    </View>
    <Text style={[styles.detail, { color: colors.textSecondary }]}>Без списания</Text>
    <View style={styles.actionRow}>
      <TypeAction label="Изменить" disabled={busy} onPress={() => { setError(null); setDutyDraft({ color: effectiveDutyColor }); }} />
    </View>
  </View>;

  return (
    <PrototypeScreen compact>
      {error !== null && draft === null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}

      <SectionHeading>Типы занятий</SectionHeading>
      {active.map((type) => (
        <Fragment key={type.id}>
        <View key={type.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {deleteButton(type)}
          <View style={styles.cardHead}>
            {swatch(typeColors.get(type.id) ?? type.color)}
            <Text style={[styles.name, { color: colors.textPrimary }]}>{type.name}</Text>
            {settings?.defaultSessionTypeId === type.id ? <StatusTag kind="success" label="По умолчанию" /> : null}
          </View>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            {`${categoryLabel[type.category]} · ${type.defaultDurationMinutes} мин · ${type.requiresCredit ? "списывает тренировку" : "без списания"}`}
          </Text>
          <View style={styles.actionRow}>
            <TypeAction label="Изменить" disabled={busy} onPress={() => openDraft({ id: type.id, name: type.name,
              category: type.category, duration: type.defaultDurationMinutes, requiresCredit: type.requiresCredit,
              color: type.color, creditLocked: type.inUse })} />
            {settings?.defaultSessionTypeId !== type.id ?
              <TypeAction label="По умолчанию" disabled={busy}
                onPress={() => { void run(() => repository.setDefaultSessionType(type.id), `«${type.name}» — тип по умолчанию.`); }} />
              : null}
            {settings?.defaultSessionTypeId !== type.id ?
              <TypeAction label="В архив" disabled={busy}
                onPress={() => { void run(() => repository.setSessionTypeArchived(type.id, true), `«${type.name}» в архиве.`); }} />
            : null}
          </View>
        </View>
          {type.id === dutyAfterId ? dutyCard : null}
        </Fragment>
      ))}
      {dutyAfterId === undefined ? dutyCard : null}
      {archived.length > 0 ? <Text style={[styles.detail, { color: colors.textSecondary }]}>В архиве:</Text> : null}
      {archived.map((type) => (
        <View key={type.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          {deleteButton(type)}
          <View style={styles.cardHead}>{swatch(type.color)}
            <Text style={[styles.name, { color: colors.textSecondary }]}>{type.name}</Text>
          </View>
          <AppButton compact size="small" variant="ghost" label="Вернуть" disabled={busy}
            onPress={() => { void run(() => repository.setSessionTypeArchived(type.id, false), `«${type.name}» снова доступен.`); }} />
        </View>
      ))}

      <AppButton variant="secondary" compact size="small" label="Добавить тип занятия" disabled={busy} onPress={() => openDraft(emptyDraft)} />
      {draft !== null ? <SessionTypeEditor draft={draft} busy={busy} error={error} occupiedColors={occupiedColors} onChange={setDraft}
        onClose={() => { if (!busy) { setDraft(null); setError(null); } }} onSave={saveDraft} /> : null}

      <Modal visible={dutyDraft !== null} transparent animationType="fade" onRequestClose={() => { if (!busy) setDutyDraft(null); }}>
        <View style={styles.dutyOverlay}>
          <Pressable accessible={false} importantForAccessibility="no" style={styles.dutyScrim} onPress={() => { if (!busy) setDutyDraft(null); }} />
          <View accessibilityViewIsModal style={[styles.dutyDialog, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.actionRow}>
              <Text accessibilityRole="header" style={[styles.name, { color: colors.textPrimary }]}>Изменить дежурство</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Закрыть редактор дежурства"
                disabled={busy} onPress={() => setDutyDraft(null)} style={styles.dutyClose}><X size={20} color={colors.iconPrimary} /></Pressable>
            </View>
            <Text style={[styles.detail, { color: colors.textSecondary }]}>Цвет в календаре</Text>
            {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      <View style={styles.policyRow} accessibilityRole="radiogroup" accessibilityLabel="Цвет дежурства">
        {[[DEFAULT_DUTY_COLOR, "Оранжевый"], ...Object.entries(sessionTypeColorHex).map(([key, value]) => [value, sessionTypeColorLabels[key as SessionTypeColor]])].map(([color, label]) => {
          const taken = [...typeColors.values()].some((key) => sessionTypeColorHex[key] === color);
          return <Pressable key={color} accessibilityRole="radio" accessibilityLabel={`${label}${taken ? ", занят" : ""}`}
          accessibilityState={{ checked: dutyDraft?.color === color, disabled: taken || busy }} disabled={taken || busy} onPress={() => setDutyDraft({ color: color! })}
          style={[styles.dutyColor, { borderColor: dutyDraft?.color === color ? colors.focusRing : "transparent", opacity: taken ? 0.2 : 1 }]}>
          <View style={[styles.swatch, { backgroundColor: color }]} />
        </Pressable>; })}
      </View>
            <View style={styles.actionRow}>
              <View style={styles.dutyAction}><AppButton compact size="small" variant="secondary" label="Отмена" disabled={busy} onPress={() => setDutyDraft(null)} /></View>
              <View style={styles.dutyAction}><AppButton compact size="small" label="Сохранить" busy={busy} onPress={() => {
                if (dutyDraft === null) return;
                const nextColor = dutyDraft.color;
                void run(async () => { await stabilizeTypeColors(); setDutyColor(nextColor); setDutyDraft(null); });
              }} /></View>
            </View>
          </View>
        </View>
      </Modal>

      {settings !== null ? <>
        <SectionHeading>Копировать неделю</SectionHeading>
        <View style={styles.policyRow}>
          <SelectionChip compact fill group="Копировать" label="Записи" selected={settings.copyPolicy.appointments} disabled={busy}
            onPress={() => policy("copyPolicy", "appointments")} />
          <SelectionChip compact fill group="Копировать" label="Дежурства" selected={settings.copyPolicy.duty} disabled={busy}
            onPress={() => policy("copyPolicy", "duty")} />
          <SelectionChip compact fill group="Копировать" label="Блокировки" selected={settings.copyPolicy.blocked} disabled={busy}
            onPress={() => policy("copyPolicy", "blocked")} />
        </View>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>
          При вставке существующая запись всегда остаётся, совпадающая копия пропускается.
        </Text>
        <SectionHeading>Очистить неделю</SectionHeading>
        <View style={styles.policyRow}>
          <SelectionChip compact fill group="Очищать" label="Записи" selected={settings.clearPolicy.appointments} disabled={busy}
            onPress={() => policy("clearPolicy", "appointments")} />
          <SelectionChip compact fill group="Очищать" label="Дежурства" selected={settings.clearPolicy.duty} disabled={busy}
            onPress={() => policy("clearPolicy", "duty")} />
          <SelectionChip compact fill group="Очищать" label="Блокировки" selected={settings.clearPolicy.blocked} disabled={busy}
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
      <ConfirmDialog visible={deleting !== null} confirmBusy={busy} destructive title="Удалить тип занятия?"
        description={deleteError ?? `Тип «${deleting?.name ?? ""}» исчезнет из списка и станет недоступен для новых записей. История записей и списаний сохранится.`}
        confirmLabel="Удалить" onCancel={() => { if (!busy) { setDeleting(null); setDeleteError(null); } }}
        onConfirm={() => { void deleteType(); }} />
      <ConfirmDialog visible={resetting} confirmBusy={busy} title="Сбросить настройки календаря?"
        description="Копирование и очистка снова включат все категории, тип по умолчанию станет «Персональная тренировка», плашка «Вернуть» снова будет показываться. Записи, дежурства, блокировки, списания и типы занятий не изменятся."
        confirmLabel="Сбросить" onCancel={() => setResetting(false)}
        onConfirm={() => { void run(async () => { await repository.resetSettings(); setResetting(false); }, "Настройки календаря сброшены."); }} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 10, gap: 4 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6, paddingRight: 24 },
  deleteButton: { position: "absolute", top: 2, right: 2, width: 32, height: 32, zIndex: 1, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  name: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  actionRow: { flexDirection: "row", alignItems: "stretch", gap: 2 },
  typeAction: { flex: 1, minWidth: 0, minHeight: 34, borderWidth: 1, borderRadius: 8, paddingHorizontal: 2, paddingVertical: 2, alignItems: "center", justifyContent: "center" },
  typeActionLabel: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16, textAlign: "center" },
  policyRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  dutyColor: { flex: 1, minWidth: 0, minHeight: 44, borderWidth: 2, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  dutyOverlay: { flex: 1, justifyContent: "center", alignItems: "center", padding: 16 },
  dutyScrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(0,0,0,0.48)" },
  dutyDialog: { width: "100%", maxWidth: 420, borderWidth: 1, borderRadius: 16, padding: 12, gap: 8 },
  dutyClose: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dutyAction: { flex: 1, minWidth: 0 },
  swatch: { width: 18, height: 18, borderRadius: 9 },
});
