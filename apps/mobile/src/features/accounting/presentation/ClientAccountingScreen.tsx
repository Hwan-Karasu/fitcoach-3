import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, InlineNotice, LoadingState, SelectionChip, TextField } from
  "../../../shared/ui/components/public.ts";
import { EmptyPanel, PrototypeScreen, SectionHeading } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { AccountingMode, ClientAccountingSnapshot, PaymentMethod } from "../domain/AccountingModel.ts";
import type { AccountingRepositoryPort } from "../domain/AccountingRepositoryPort.ts";
import { formatKopeks, parseRublesToKopeks, pricePerSessionKopeks } from "../domain/AccountingRules.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const modeLabels: Readonly<Record<AccountingMode, string>> = {
  FITCOACH: "В FitCoach", EXTERNAL: "Внешний учёт", UNTRACKED: "Не ведётся",
};
const methodLabels: Readonly<Record<PaymentMethod, string>> = {
  transfer: "Перевод", cash: "Наличные", other: "Другое",
};

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function shortDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso
    : `${String(at.getDate()).padStart(2, "0")}.${String(at.getMonth() + 1).padStart(2, "0")}.${at.getFullYear()}`;
}

function accountingError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code === "ACCOUNTING_PACK_INVALID") return "Проверьте название, количество (1–1000) и стоимость пакета.";
  if (code === "ACCOUNTING_PACK_SCOPE_INVALID") return "Выберите доступный платный тип занятия.";
  if (code === "ACCOUNTING_PAYMENT_INVALID") return "Укажите сумму больше нуля и дату оплаты.";
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
  const [snapshot, setSnapshot] = useState<ClientAccountingSnapshot | null>(null);
  const [types, setTypes] = useState<readonly Readonly<{ id: string; name: string }>[]>([]);
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [packOpen, setPackOpen] = useState(false);
  const [packTitle, setPackTitle] = useState("");
  const [packCount, setPackCount] = useState("10");
  const [packPrice, setPackPrice] = useState("");
  const [packTypeId, setPackTypeId] = useState<string | null>(null);
  const [packExpires, setPackExpires] = useState("");
  const [payOpen, setPayOpen] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<PaymentMethod>("transfer");
  const [payPackId, setPayPackId] = useState<string | null>(null);
  const [payDate, setPayDate] = useState(today);
  const [payNote, setPayNote] = useState("");

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

  const history = useMemo(() => {
    if (snapshot === null) return [];
    const packTitle = (id: string | null) => snapshot.packs.find((row) => row.pack.id === id)?.pack.title;
    return [
      ...snapshot.ledger.map((row) => ({ at: row.createdAt, key: row.id, text:
        row.entryType === "ISSUED" ? `+${row.delta} тренировок — ${packTitle(row.packId) ?? "пакет"}`
          : row.entryType === "USED" ? "−1 тренировка — запись в календаре"
            : row.entryType === "RETURNED" ? "+1 тренировка — возврат"
              : `${row.delta > 0 ? "+" : "−"}${Math.abs(row.delta)} — корректировка: ${row.reason ?? ""}` })),
      ...snapshot.payments.map((row) => ({ at: row.createdAt, key: row.id, text:
        `+${formatKopeks(row.amountKopeks)} — ${methodLabels[row.method].toLocaleLowerCase("ru")}`
        + ` (${row.paidOn.split("-").reverse().join(".")})${row.note ? ` · ${row.note}` : ""}` })),
    ].sort((a, b) => b.at.localeCompare(a.at));
  }, [snapshot]);

  const run = async (task: () => Promise<void>, done: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try { await task(); setNotice(done); }
    catch (failure) { setError(accountingError(failure)); }
    finally { setBusy(false); }
  };

  const savePack = () => run(async () => {
    const count = /^\d{1,4}$/u.test(packCount.trim()) ? Number(packCount.trim()) : Number.NaN;
    const price = parseRublesToKopeks(packPrice);
    if (!Number.isSafeInteger(count) || price === "invalid") throw new Error("ACCOUNTING_PACK_INVALID");
    const type = types.find((row) => row.id === packTypeId) ?? null;
    await repository.createPack(clientId, {
      title: packTitle.trim() || `Пакет ${count}`, creditScope: type === null ? "GENERAL" : "SESSION_TYPE",
      sessionTypeId: type?.id ?? null, sessionTypeName: type?.name ?? null, grantedCount: count,
      totalKopeks: price === "empty" ? 0 : price, expiresOn: packExpires.trim() || null,
    });
    setPackOpen(false);
    setPackTitle(""); setPackPrice(""); setPackExpires(""); setPackTypeId(null);
  }, "Пакет добавлен, тренировки начислены.");

  const savePayment = () => run(async () => {
    const amount = parseRublesToKopeks(payAmount);
    if (typeof amount !== "number") throw new Error("ACCOUNTING_PAYMENT_INVALID");
    await repository.recordPayment(clientId, { packId: payPackId, amountKopeks: amount,
      paidOn: payDate.trim(), method: payMethod, note: payNote });
    setPayOpen(false);
    setPayAmount(""); setPayNote("");
  }, "Оплата записана.");

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
      <View style={styles.chips}>
        {(Object.keys(modeLabels) as AccountingMode[]).map((mode) => (
          <SelectionChip key={mode} group="Учёт занятий" label={modeLabels[mode]}
            selected={snapshot.mode === mode} disabled={busy}
            onPress={() => { void run(() => repository.setClientMode(clientId, mode), "Режим учёта сохранён."); }} />
        ))}
      </View>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        {snapshot.mode === "FITCOACH"
          ? "Записи с платным типом резервируют тренировку и списывают её по окончании времени."
          : "Календарь работает без пакетов; тренировки в FitCoach не списываются."}
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
      {snapshot.packs.length === 0 ? (
        <EmptyPanel title="Пакетов нет" body="Это не означает ноль тренировок: запись в календарь доступна в любом режиме." />
      ) : null}
      {snapshot.packs.map(({ pack, available, reserved, paidKopeks }) => (
        <View key={pack.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.name, { color: colors.textPrimary }]}>{pack.title}</Text>
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
        </View>
      ))}
      {packOpen ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextField label="Название" value={packTitle} onChangeText={setPackTitle} placeholder={`Пакет ${packCount || "10"}`} />
          <TextField label="Количество тренировок" value={packCount} onChangeText={setPackCount}
            keyboardType="number-pad" required />
          <TextField label="Стоимость пакета, ₽" value={packPrice} onChangeText={setPackPrice}
            keyboardType="decimal-pad" placeholder="Например, 15 000" />
          <Text style={[styles.label, { color: colors.textPrimary }]}>Для каких занятий</Text>
          <View style={styles.chips}>
            <SelectionChip group="Пакет" label="Любые платные" selected={packTypeId === null}
              onPress={() => setPackTypeId(null)} />
            {types.map((type) => (
              <SelectionChip key={type.id} group="Пакет" label={type.name} selected={packTypeId === type.id}
                onPress={() => setPackTypeId(type.id)} />
            ))}
          </View>
          <TextField label="Действует до" value={packExpires} onChangeText={setPackExpires}
            placeholder="ГГГГ-ММ-ДД, необязательно" />
          <AppButton label="Начислить пакет" busy={busy} onPress={() => { void savePack(); }} />
          <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={() => setPackOpen(false)} />
        </View>
      ) : <AppButton variant="secondary" label="Добавить пакет" onPress={() => setPackOpen(true)} />}

      <SectionHeading>Оплаты</SectionHeading>
      {payOpen ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <TextField label="Сумма, ₽" value={payAmount} onChangeText={setPayAmount}
            keyboardType="decimal-pad" required />
          <View style={styles.chips}>
            {(Object.keys(methodLabels) as PaymentMethod[]).map((method) => (
              <SelectionChip key={method} group="Способ" label={methodLabels[method]}
                selected={payMethod === method} onPress={() => setPayMethod(method)} />
            ))}
          </View>
          {snapshot.packs.length > 0 ? <View style={styles.chips}>
            <SelectionChip group="Пакет" label="Без пакета" selected={payPackId === null}
              onPress={() => setPayPackId(null)} />
            {snapshot.packs.map(({ pack }) => (
              <SelectionChip key={pack.id} group="Пакет" label={pack.title} selected={payPackId === pack.id}
                onPress={() => setPayPackId(pack.id)} />
            ))}
          </View> : null}
          <TextField label="Дата оплаты" value={payDate} onChangeText={setPayDate} placeholder="ГГГГ-ММ-ДД" />
          <TextField label="Заметка" value={payNote} onChangeText={setPayNote} placeholder="Необязательно" />
          <AppButton label="Записать оплату" busy={busy} onPress={() => { void savePayment(); }} />
          <AppButton variant="ghost" label="Отмена" disabled={busy} onPress={() => setPayOpen(false)} />
        </View>
      ) : <AppButton variant="secondary" label="Записать оплату" onPress={() => setPayOpen(true)} />}
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        FitCoach не принимает деньги: здесь только фиксируется уже произошедшая оплата.
      </Text>

      <SectionHeading>История абонемента и оплаты</SectionHeading>
      {history.length === 0 ? <Text style={[styles.hint, { color: colors.textSecondary }]}>Пока пусто.</Text> : null}
      {history.map((row) => (
        <Text key={row.key} style={[styles.detail, { color: colors.textPrimary }]}>
          {shortDate(row.at)} · {row.text}
        </Text>
      ))}
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  hint: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  summary: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 4 },
  big: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bold },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  name: { fontSize: 16, lineHeight: 22, fontFamily: fonts.bold },
  label: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bold },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
});
