import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton, InlineNotice, LoadingState, pickDate, TextField } from
  "../../../shared/ui/components/public.ts";
import { EmptyPanel, PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { AccountingMode, ClientAccountingSnapshot, PaymentMethod } from "../domain/AccountingModel.ts";
import type { AccountingRepositoryPort } from "../domain/AccountingRepositoryPort.ts";
import { formatKopeks, pricePerSessionKopeks } from "../domain/AccountingRules.ts";
import { AccountingHistory } from "./AccountingHistory.tsx";
import { derivePackPricing, type PackPriceBasis } from "../domain/PackPricing.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const modeLabels: Readonly<Record<AccountingMode, string>> = {
  FITCOACH: "В приложении", EXTERNAL: "Внешний учёт", UNTRACKED: "Не ведётся",
};
const methodLabels: Readonly<Record<PaymentMethod, string>> = {
  transfer: "Перевод", cash: "Наличные", other: "Другое",
};

const GENERAL_SCOPE = "GENERAL";

/** Общая рамка и один ряд, как переключатель «Точно / Коридор» на главной. */
function AccountingSegments<Id extends string>({ title, items, selected, onSelect, disabled }: Readonly<{
  title: string; items: readonly Readonly<{ id: Id; label: string }>[]; selected: Id;
  onSelect: (id: Id) => void; disabled: boolean;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  return <View accessibilityRole="radiogroup" accessibilityLabel={title}
    style={[styles.segments, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
    {items.map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityLabel={item.label}
      accessibilityState={{ checked: selected === item.id, disabled }} disabled={disabled} onPress={() => onSelect(item.id)}
      style={[styles.segment, { backgroundColor: selected === item.id ? colors.accentFill : "transparent", opacity: disabled ? 0.6 : 1 }]}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}
        style={[styles.segmentLabel, { color: selected === item.id ? colors.onAccentFill : colors.textPrimary }]}>{item.label}</Text>
    </Pressable>)}
  </View>;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function accountingError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "ACCOUNTING_PACK_INVALID") return "Проверьте название, количество (1–1000) и стоимость пакета.";
  if (code === "ACCOUNTING_PACK_SCOPE_INVALID") return "Выберите доступный платный тип занятия.";
  if (code === "ACCOUNTING_PAYMENT_INVALID") return "Укажите сумму больше нуля и дату оплаты.";
  if (code === "ACCOUNTING_PREFERRED_PACK_INVALID") return "В этом пакете нет доступных занятий или истёк срок действия. Выберите другой пакет.";
  return "Не удалось сохранить. Данные учёта не изменены.";
}

/** §22.1: modes, packs and manual payments of one client; balances come only from the ledger. */
export function ClientAccountingScreen({ clientId, repository, listCreditSessionTypes }: Readonly<{
  clientId: string;
  repository: AccountingRepositoryPort;
  listCreditSessionTypes: () => Promise<readonly Readonly<{ id: string; name: string }>[]>;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const insets = useSafeAreaInsets();
  const [snapshot, setSnapshot] = useState<ClientAccountingSnapshot | null>(null);
  const [types, setTypes] = useState<readonly Readonly<{ id: string; name: string }>[]>([]);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const actionLock = useRef(false);
  const [packOpen, setPackOpen] = useState(false);
  const [packTitle, setPackTitle] = useState("");
  const [packCount, setPackCount] = useState("10");
  const [packPrice, setPackPrice] = useState("");
  const [sessionPrice, setSessionPrice] = useState("");
  const [priceBasis, setPriceBasis] = useState<PackPriceBasis>("TOTAL");
  const pricing = derivePackPricing(packCount, packPrice, sessionPrice, priceBasis);
  const [packTypeId, setPackTypeId] = useState<string | null>(null);
  const [packExpires, setPackExpires] = useState("");
  const [packPaid, setPackPaid] = useState(true);
  const [packPaymentDate, setPackPaymentDate] = useState(today);
  const [packPaymentMethod, setPackPaymentMethod] = useState<PaymentMethod>("transfer");

  const load = useCallback(() => {
    void Promise.all([repository.getClientSnapshot(clientId), listCreditSessionTypes()]).then(
      ([next, creditTypes]) => { setSnapshot(next); setTypes(creditTypes); setFailed(false); },
      () => setFailed(true));
  }, [clientId, listCreditSessionTypes, repository]);

  useEffect(() => {
    load();
    return repository.subscribeCommittedChanges((change) => {
      if (change.clientIds === "ALL" || change.clientIds.includes(clientId)) load();
    });
  }, [clientId, load, repository]);

  const run = async (task: () => Promise<void>, done: string) => {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await task(); setNotice(done); }
    catch (failure) { setError(accountingError(failure)); }
    finally { actionLock.current = false; setBusy(false); }
  };

  const savePack = () => run(async () => {
    const count = pricing.count;
    const price = pricing.totalKopeks;
    if (count === null || price === "invalid") throw new Error("ACCOUNTING_PACK_INVALID");
    const type = types.find((row) => row.id === packTypeId) ?? null;
    await repository.createPack(clientId, {
      title: packTitle.trim() || `Пакет ${count}`, creditScope: type === null ? "GENERAL" : "SESSION_TYPE",
      sessionTypeId: type?.id ?? null, sessionTypeName: type?.name ?? null, grantedCount: count,
      totalKopeks: price === "empty" ? 0 : price, expiresOn: packExpires.trim() || null,
      payment: packPaid && typeof price === "number" && price > 0 ? { paidOn: packPaymentDate, method: packPaymentMethod } : undefined,
    });
    setPackOpen(false);
    setPackTitle(""); setPackCount("10"); setPackPrice(""); setSessionPrice(""); setPriceBasis("TOTAL"); setPackExpires(""); setPackTypeId(null);
    setPackPaid(true); setPackPaymentDate(today()); setPackPaymentMethod("transfer");
  }, packPaid && typeof pricing.totalKopeks === "number" && pricing.totalKopeks > 0 ? "Пакет добавлен, занятия начислены и оплата записана." : "Пакет добавлен, тренировки начислены.");

  if (snapshot === null) {
    return <PrototypeScreen>
      {failed ? <>
        <InlineNotice kind="error">Не удалось загрузить учёт клиента.</InlineNotice>
        <AppButton label="Повторить" onPress={load} />
      </> : <LoadingState label="Загружаем учёт…" />}
    </PrototypeScreen>;
  }

  return (
    <PrototypeScreen>
      <SectionHeading>Учёт занятий</SectionHeading>
      <AccountingSegments title="Учёт занятий" items={(Object.keys(modeLabels) as AccountingMode[]).map((id) => ({ id, label: modeLabels[id] }))}
        selected={snapshot.mode} disabled={busy} onSelect={(mode) => { void run(() => repository.setClientMode(clientId, mode), "Режим учёта сохранён."); }} />
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        {snapshot.mode === "FITCOACH"
          ? "Записи с платным типом резервируют тренировку и списывают её по окончании времени."
          : "Календарь работает без пакетов; тренировки в приложении не списываются."}
        {snapshot.inheritedMode ? " Сейчас действует режим по умолчанию." : ""}
      </Text>
      {snapshot.packs.length > 0 ? (
        <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.big, { color: colors.textPrimary }]}>Доступно: {snapshot.available}</Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Зарезервировано на будущие записи: {snapshot.reserved}
          </Text>
        </View>
      ) : null}
      {notice !== null ? <InlineNotice kind="success">{notice}</InlineNotice> : null}
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}

      <SectionHeading>Пакеты</SectionHeading>
      {snapshot.mode === "FITCOACH" && snapshot.packs.length > 1 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Нажмите на пакет, чтобы списывать занятия из него. Повторное нажатие возвращает автоматический выбор.</Text> : null}
      {snapshot.packs.length === 0 ? (
        <EmptyPanel title="Пакетов нет" body="Это не означает ноль тренировок: запись в календарь доступна в любом режиме." />
      ) : null}
      {snapshot.packs.map(({ pack, available, reserved, paidKopeks }) => (
        <Pressable key={pack.id} accessibilityRole="radio" accessibilityLabel={`Пакет «${pack.title}», доступно ${available} из ${pack.grantedCount}`}
          accessibilityHint={snapshot.preferredPackId === pack.id ? "Основной пакет. Нажмите, чтобы вернуть автоматический выбор." : "Выбрать для списания следующих занятий"}
          accessibilityState={{ checked: snapshot.preferredPackId === pack.id, disabled: busy || snapshot.mode !== "FITCOACH" || (snapshot.preferredPackId !== pack.id && (available < 1 || pack.expiresOn !== null && pack.expiresOn < today())) }}
          disabled={busy || snapshot.mode !== "FITCOACH" || (snapshot.preferredPackId !== pack.id && (available < 1 || pack.expiresOn !== null && pack.expiresOn < today()))}
          onPress={() => { void run(() => repository.setPreferredPack(clientId, snapshot.preferredPackId === pack.id ? null : pack.id), snapshot.preferredPackId === pack.id ? "Включён автоматический выбор пакета." : "Пакет выбран для следующих записей."); }}
          style={[styles.card, { backgroundColor: snapshot.preferredPackId === pack.id ? colors.accentSoft : colors.surface,
            borderColor: snapshot.preferredPackId === pack.id ? colors.accentInk : colors.border }]}>
          <View style={styles.packHeading}>
            <Text style={[styles.name, styles.packName, { color: colors.textPrimary }]}>{pack.title}</Text>
            {snapshot.mode === "FITCOACH" ? <View style={[styles.packCheck, { borderColor: snapshot.preferredPackId === pack.id ? colors.accentFill : colors.border,
              backgroundColor: snapshot.preferredPackId === pack.id ? colors.accentFill : "transparent" }]}>
              {snapshot.preferredPackId === pack.id ? <Check size={15} color={colors.onAccentFill} strokeWidth={2.5} /> : null}
            </View> : null}
          </View>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Осталось {available} из {pack.grantedCount}{reserved > 0 ? ` · в резерве ${reserved}` : ""}
            {" · "}{pack.creditScope === "GENERAL" ? "любые платные занятия" : pack.sessionTypeName}
          </Text>
          <Text style={[styles.detail, { color: colors.textSecondary }]}>
            {formatKopeks(pack.totalKopeks)} · {formatKopeks(pricePerSessionKopeks(pack.totalKopeks, pack.grantedCount))} за занятие
            {pack.totalKopeks > 0 ? ` · оплачено ${formatKopeks(paidKopeks)}` : ""}
            {pack.totalKopeks > paidKopeks ? ` · к оплате ${formatKopeks(pack.totalKopeks - paidKopeks)}` : ""}
          </Text>
          {pack.expiresOn !== null ? <Text style={[styles.detail, { color: colors.textSecondary }]}>
            Действует до {pack.expiresOn.split("-").reverse().join(".")}
          </Text> : null}
        </Pressable>
      ))}
      <AppButton variant="secondary" label="Добавить пакет" disabled={busy} onPress={() => { setError(null); setPackPaymentDate(today()); setPackOpen(true); }} />
      <Modal visible={packOpen} transparent animationType="fade" statusBarTranslucent
        onRequestClose={() => { if (!busy) setPackOpen(false); }}>
        <KeyboardAvoidingView behavior="padding" style={styles.sheetBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Закрыть новый пакет"
            disabled={busy} onPress={() => setPackOpen(false)} />
          <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={styles.sheetHeader}>
              <Text accessibilityRole="header" style={[styles.name, { color: colors.textPrimary }]}>Новый пакет</Text>
              <AppButton compact variant="ghost" label="Закрыть" disabled={busy} onPress={() => setPackOpen(false)} />
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.formContent}>
              <TextField label="Название" value={packTitle} disabled={busy} onChangeText={setPackTitle} placeholder={`Пакет ${packCount || "10"}`} />
              <View style={styles.priceRow}>
                <View style={styles.priceCell}><TextField label="Пакет, ₽" value={pricing.totalText} disabled={busy}
                  onChangeText={(text) => { setPackPrice(text); setPriceBasis("TOTAL"); }} keyboardType="decimal-pad" placeholder="15000" /></View>
                <View style={styles.priceCell}><TextField label="Тренировок" value={packCount} disabled={busy} onChangeText={setPackCount}
                  keyboardType="number-pad" placeholder="10" /></View>
                <View style={styles.priceCell}><TextField label="За занятие, ₽" value={pricing.sessionText} disabled={busy}
                  onChangeText={(text) => { setSessionPrice(text); setPriceBasis("SESSION"); }} keyboardType="decimal-pad" placeholder="1500" /></View>
              </View>
              <Text style={[styles.label, { color: colors.textPrimary }]}>Для каких занятий</Text>
              <AccountingSegments title="Для каких занятий" items={[{ id: GENERAL_SCOPE, label: "Любые платные" }, ...types.map((type) => ({ id: type.id, label: type.name }))]}
                selected={packTypeId ?? GENERAL_SCOPE} disabled={busy} onSelect={(id) => setPackTypeId(id === GENERAL_SCOPE ? null : id)} />
              <AppButton variant="secondary" label={`Действует до: ${packExpires === "" ? "без срока" : packExpires.split("-").reverse().join(".")}`}
                disabled={busy} onPress={() => { void pickDate({ value: packExpires || today(), title: "Действует до" }).then((date) => { if (date !== null) setPackExpires(date); }); }} />
              {packExpires !== "" ? <AppButton compact variant="ghost" label="Убрать срок действия" disabled={busy} onPress={() => setPackExpires("")} /> : null}
              <Text style={[styles.label, { color: colors.textPrimary }]}>Оплата пакета</Text>
              <AccountingSegments title="Оплата нового пакета" items={[{ id: "PAID", label: "Оплачен" }, { id: "UNPAID", label: "Без оплаты" }]}
                selected={packPaid ? "PAID" : "UNPAID"} disabled={busy} onSelect={(value) => setPackPaid(value === "PAID")} />
              {packPaid ? <View style={styles.packPayment}>
                <Text style={[styles.detail, { color: colors.textPrimary }]}>Сумма оплаты: {typeof pricing.totalKopeks === "number" ? formatKopeks(pricing.totalKopeks) : "—"}</Text>
                <AccountingSegments title="Способ оплаты пакета" items={(Object.keys(methodLabels) as PaymentMethod[]).map((id) => ({ id, label: methodLabels[id] }))}
                  selected={packPaymentMethod} disabled={busy} onSelect={setPackPaymentMethod} />
                <AppButton variant="secondary" label={`Дата оплаты: ${packPaymentDate.split("-").reverse().join(".")}`} disabled={busy}
                  onPress={() => { void pickDate({ value: packPaymentDate, title: "Дата оплаты пакета" }).then((date) => { if (date !== null) setPackPaymentDate(date); }); }} />
                {typeof pricing.totalKopeks !== "number" || pricing.totalKopeks === 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Укажите стоимость пакета. При нулевой стоимости оплата не записывается.</Text> : null}
              </View> : null}
              {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
              <AppButton label={packPaid && typeof pricing.totalKopeks === "number" && pricing.totalKopeks > 0 ? "Добавить пакет и оплату" : "Начислить пакет"} busy={busy} onPress={() => { void savePack(); }} />
              <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={() => setPackOpen(false)} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <AccountingHistory snapshot={snapshot} />
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: "row", borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  segment: { flex: 1, minWidth: 0, minHeight: 44, paddingHorizontal: 6, alignItems: "center", justifyContent: "center" },
  segmentLabel: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 17 },
  priceRow: { flexDirection: "row", gap: 8 },
  priceCell: { flex: 1, minWidth: 0 },
  packHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  packName: { flex: 1 },
  packCheck: { width: 23, height: 23, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  packPayment: { gap: 10 },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { maxHeight: "90%", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 16, paddingTop: 8 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  formContent: { gap: 12, paddingVertical: 12 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  summary: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  big: { fontSize: 18, lineHeight: 23, fontFamily: fonts.bold },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  name: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold },
  label: { fontSize: 13, lineHeight: 18, fontFamily: fonts.bold },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 17 },
});
