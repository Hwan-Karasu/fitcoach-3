import { useRef } from "react";
import { AccessibilityInfo, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View, findNodeHandle } from "react-native";
import { X } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton, AppIconButton, ChoiceSegments, InlineNotice, SelectionChip, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import { APPOINTMENT_DURATIONS, SESSION_TYPE_COLORS, type SessionTypeCategory, type SessionTypeColor } from "../domain/CalendarModel.ts";
import { sessionTypeColorHex } from "./calendarPresentation.ts";
import { sessionTypeColorLabels } from "./calendarTypeColors.ts";

export const sessionCategoryLabels: Readonly<Record<SessionTypeCategory, string>> = {
  TRAINING: "Тренировка", INSTRUCTION: "Инструктаж", CONSULTATION: "Консультация", OTHER: "Другое",
};

export interface SessionTypeDraft {
  readonly id: string | null;
  readonly name: string;
  readonly category: SessionTypeCategory;
  readonly duration: number;
  readonly requiresCredit: boolean;
  readonly color: SessionTypeColor | null;
  readonly creditLocked: boolean;
}

/** Context editor: opens above the current card, never below the visible list. */
export function SessionTypeEditor({ draft, busy, error, occupiedColors, onChange, onClose, onSave }: Readonly<{
  draft: SessionTypeDraft; busy: boolean; error: string | null; onChange: (value: SessionTypeDraft) => void;
  occupiedColors: ReadonlySet<string>;
  onClose: () => void; onSave: () => void;
}>) {
  const { palette: { tokens: colors } } = usePrototypeTheme();
  const insets = useSafeAreaInsets();
  const title = useRef<Text>(null);
  const close = () => { if (!busy) onClose(); };
  const categories = Object.keys(sessionCategoryLabels) as SessionTypeCategory[];
  return <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={close}
    onShow={() => { const handle = findNodeHandle(title.current); if (handle !== null) AccessibilityInfo.setAccessibilityFocus(handle); }}>
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={[styles.overlay, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
      <Pressable style={StyleSheet.absoluteFill} accessible={false} importantForAccessibility="no" onPress={close} />
      <View accessibilityViewIsModal style={[styles.card, { backgroundColor: colors.surface }]} testID="session-type-editor">
        <View style={styles.header}>
          <Text ref={title} accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{draft.id === null ? "Новый тип занятия" : "Изменить тип занятия"}</Text>
          <AppIconButton label="Закрыть редактор типа занятия" disabled={busy} onPress={close} icon={<X size={20} color={colors.iconPrimary} />} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.fields} keyboardShouldPersistTaps="handled">
          {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
          <TextField compact label="Название" value={draft.name} required disabled={busy} placeholder="Название занятия"
            onChangeText={(name) => onChange({ ...draft, name })} testID="session-type-name" />
          <Text style={[styles.label, { color: colors.textSecondary }]}>Категория</Text>
          {[0, 2].map((start) => <View key={start} style={styles.row}>
            {categories.slice(start, start + 2).map((category) => <SelectionChip key={category} compact fill
              group="Категория" label={sessionCategoryLabels[category]} selected={draft.category === category} disabled={busy}
              onPress={() => onChange({ ...draft, category })} />)}
          </View>)}
          <Text style={[styles.label, { color: colors.textSecondary }]}>Длительность</Text>
          <ChoiceSegments label="Длительность занятия" items={APPOINTMENT_DURATIONS.map((minutes) => ({ id: String(minutes), label: `${minutes} мин` }))}
            value={String(draft.duration)} disabled={busy} onChange={(value) => onChange({ ...draft, duration: Number(value) })} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>Цвет в календаре</Text>
          <View style={styles.row}>
            {SESSION_TYPE_COLORS.map((color) => <Pressable key={color}
              accessibilityRole="radio" accessibilityLabel={`${sessionTypeColorLabels[color]}${occupiedColors.has(sessionTypeColorHex[color]) ? ", занят" : ""}`}
              accessibilityState={{ selected: draft.color === color, disabled: busy || occupiedColors.has(sessionTypeColorHex[color]) }} disabled={busy || occupiedColors.has(sessionTypeColorHex[color])}
              onPress={() => onChange({ ...draft, color })} style={styles.colorTouch}>
              <View style={[styles.colorRing, { borderColor: draft.color === color ? colors.focusRing : "transparent" }]}>
                <View style={[styles.swatch, { backgroundColor: sessionTypeColorHex[color], opacity: occupiedColors.has(sessionTypeColorHex[color]) ? 0.2 : 1 }]} />
              </View>
            </Pressable>)}
          </View>
          <View style={styles.creditRow}>
            <Text style={[styles.creditLabel, { color: colors.textPrimary }]}>Списывать из пакета</Text>
            <Switch accessibilityLabel="Списывает тренировку из пакета" value={draft.requiresCredit} disabled={busy || draft.creditLocked}
              trackColor={{ false: colors.border, true: colors.accentFill }} thumbColor={colors.surface}
              onValueChange={(requiresCredit) => onChange({ ...draft, requiresCredit })} />
          </View>
          {draft.creditLocked ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Списание зафиксировано: тип уже используется в записях.</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <View style={styles.cell}><AppButton compact size="small" variant="secondary" label="Отмена" disabled={busy} onPress={close} /></View>
          <View style={styles.cell}><AppButton compact size="small" label="Сохранить" busy={busy} disabled={!draft.name.trim()}
            onPress={() => { Keyboard.dismiss(); onSave(); }} /></View>
        </View>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", paddingHorizontal: 16, backgroundColor: "rgba(0,0,0,0.4)" },
  card: { width: "100%", maxWidth: 420, maxHeight: "100%", borderRadius: 22, padding: 12, gap: 8 },
  header: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontFamily: fonts.bold, fontSize: 16, lineHeight: 21 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  fields: { gap: 7 },
  label: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, marginTop: 3 },
  row: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  colorTouch: { flex: 1, minWidth: 0, minHeight: 38, alignItems: "center", justifyContent: "center" },
  colorRing: { borderWidth: 2, borderRadius: 16, padding: 3 },
  swatch: { width: 18, height: 18, borderRadius: 9 },
  creditRow: { minHeight: 38, flexDirection: "row", alignItems: "center", gap: 8 },
  creditLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18 },
  hint: { fontFamily: fonts.regular, fontSize: 11, lineHeight: 15 },
  footer: { flexDirection: "row", gap: 8, paddingTop: 4 },
  cell: { flex: 1, minWidth: 0 },
});
