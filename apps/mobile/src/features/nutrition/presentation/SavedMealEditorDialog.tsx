import { useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, TextField } from "../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../shared/ui/theme/typography.ts";
import type { FoodSnapshot } from "../domain/FoodSnapshot.ts";
import type { SavedMeal, SavedMealInput } from "../domain/SavedMeal.ts";
import { formatDecimalX10, parseDecimalX10 } from "../domain/FoodRules.ts";
import { normalizeSnapshot } from "../domain/DiaryRules.ts";
import { kcalText, nutritionErrorText, unitLabels } from "./nutritionFormat.ts";

/** Mounted once per editing session; errors retain the complete form. */
export function SavedMealEditorDialog({ meal, snapshots, initialName, onAddItems, onSave, onDelete, onClose }: Readonly<{
  meal?: SavedMeal; snapshots: readonly FoodSnapshot[]; onSave: (input: SavedMealInput) => Promise<void>;
  initialName?: string; onAddItems?: (input: SavedMealInput) => void;
  onDelete?: () => Promise<void>; onClose: () => void;
}>) {
  const colors = usePrototypeTheme().palette.tokens;
  const [name, setName] = useState(initialName ?? meal?.name ?? "");
  const [rows, setRows] = useState(() => snapshots.map((snapshot, index) => ({ id: index, snapshot, text: formatDecimalX10(snapshot.quantityX10) })));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const lock = useRef(false);
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try { await work(); onClose(); } catch (failure) { setError(nutritionErrorText(failure)); }
    finally { lock.current = false; setBusy(false); }
  };
  const save = () => {
    if (name.trim() === "" || name.trim().length > 80) { setError("Введите название до 80 символов."); return; }
    if (rows.length === 0) { setError("Добавьте хотя бы одну позицию."); return; }
    const quantities = rows.map((row) => parseDecimalX10(row.text));
    if (quantities.some((quantity) => quantity === null || quantity <= 0)) { setError("Количество каждой позиции должно быть больше нуля."); return; }
    void run(async () => onSave({ name, snapshots: rows.map((row, index) => normalizeSnapshot({ ...row.snapshot, quantityX10: quantities[index]! })) }));
  };
  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
    <View style={styles.backdrop}><View style={[styles.dialog, { backgroundColor: colors.surface }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>{meal ? "Изменить сохранённую еду" : "Новая сохранённая еда"}</Text>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TextField label="Название набора" value={name} onChangeText={setName} disabled={busy} required />
        {rows.map((row) => <View key={row.id} style={styles.body}>
          <Text style={{ color: colors.textPrimary, fontFamily: fonts.semibold }}>{row.snapshot.name}</Text>
          <TextField label={`Количество, ${unitLabels[row.snapshot.basis.unit]}`} value={row.text} disabled={busy} keyboardType="decimal-pad"
            onChangeText={(text) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, text } : item))} />
          <Text style={{ color: colors.textSecondary }}>{(() => {
            const quantity = parseDecimalX10(row.text);
            try { return quantity !== null && quantity > 0 ? kcalText(normalizeSnapshot({ ...row.snapshot, quantityX10: quantity }).eaten) : "Укажите количество"; }
            catch { return "Проверьте количество"; }
          })()}</Text>
          <AppButton compact variant="ghost" label={`Убрать: ${row.snapshot.name}`} disabled={busy} onPress={() => setRows((current) => current.filter((item) => item.id !== row.id))} />
        </View>)}
        {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      </ScrollView>
      {onAddItems ? <AppButton variant="secondary" label="Добавить позиции" disabled={busy} onPress={() => {
        try {
          const next = rows.map((row) => {
            const quantityX10 = parseDecimalX10(row.text);
            if (quantityX10 === null || quantityX10 <= 0) throw new Error("INVALID_PORTION");
            return normalizeSnapshot({ ...row.snapshot, quantityX10 });
          });
          onAddItems({ name, snapshots: next });
        } catch (failure) { setError(nutritionErrorText(failure)); }
      }} /> : null}
      <AppButton label="Сохранить набор" busy={busy} onPress={save} />
      {onDelete ? <AppButton variant="destructive" label={confirmDelete ? "Подтвердить удаление набора" : "Удалить набор"} disabled={busy}
        onPress={() => { if (confirmDelete) void run(onDelete); else setConfirmDelete(true); }} /> : null}
      <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={onClose} />
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, padding: 16, justifyContent: "center", backgroundColor: "rgba(0,0,0,0.45)" },
  dialog: { maxHeight: "92%", padding: 16, borderRadius: 20, gap: 8 },
  title: { fontFamily: fonts.bold, fontSize: 18 }, body: { gap: 8, paddingBottom: 8 },
});
