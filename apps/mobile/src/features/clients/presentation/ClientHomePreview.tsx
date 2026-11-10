import { useRef, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Archive } from "lucide-react-native";
import { AppButton, ConfirmDialog, InlineNotice, ProgressBar, StatusTag } from
  "../../../shared/ui/components/public.ts";
import { shadow } from "../../../shared/ui/theme/style.ts";
import { PrototypeScreen } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ClientHomeSummary, HomePackSummary } from "../domain/ClientHomeSummary.ts";
import type { ClientRecord } from "../domain/ClientRepositoryPort.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const toneLabel = { active: "Активен", warning: "Подходит к концу", empty: "Закончился" } as const;
const toneKind = { active: "success", warning: "warning", empty: "action_required" } as const;

function creditErrorText(failure: unknown): string {
  switch (failure instanceof Error ? failure.message : "") {
    case "ACCOUNTING_INSUFFICIENT_CREDIT": return "Нет доступных занятий: списывать нечего. Данные учёта не изменены.";
    case "ACCOUNTING_NOT_TRACKED": return "Учёт этого клиента не ведётся в приложении. Данные учёта не изменены.";
    case "ACCOUNTING_NOTHING_TO_RETURN": return "Возвращать нечего: последнее списание уже отменено.";
    case "ACCOUNTING_STALE": return "Журнал изменился. Проверьте абонемент и повторите.";
    default: return "Не удалось сохранить. Данные учёта не изменены.";
  }
}

function formatIsoDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

/** Компактная сводка абонемента: «доступно N/M» в строке заголовка, вторая строка — цена и срок либо состояние. */
function PackSummaryLine({ pack }: Readonly<{ pack: HomePackSummary | null }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const line = (text: string) => <Text style={[styles.detail, { color: colors.textSecondary }]}>{text}</Text>;
  if (pack === null) return line("Загружаем…");
  if (pack.kind === "UNAVAILABLE") return line("Сводка абонемента не загрузилась. Данные учёта не изменены.");
  if (pack.kind === "NOT_TRACKED") return line(pack.label);
  if (pack.kind === "NO_PACK") return line("Пакетов нет");
  const extra = [pack.pricePerSession !== null ? `Цена: ${pack.pricePerSession}` : null, pack.expiresOn !== null ? `до ${formatIsoDate(pack.expiresOn)}` : null].filter((part) => part !== null).join(" · ");
  return extra === "" ? null : line(extra);
}

/**
 * Client Home (UX 2.0): identity header with the edit pencil, abonement first, then the nutrition blocks (day data and КБЖУ, supplied by the shell), archive last —
 * all projections of their owners' facts; no invented dashboard blocks.
 */
export function ClientHomePreview({ client, summary, onOpenAccounting, onWriteOff, onReturnLast, nutritionSlot, daySlot,
  onArchive }: Readonly<{
  /** Ряд дней «Вчера | Сегодня | Завтра» и календарь — сверху экрана; подставляется оболочкой (день общий с «Питанием»). */
  daySlot?: ReactNode;
  /** Блоки питания (шаги, КБЖУ) — проекция Nutrition, подставляется оболочкой; Clients не знает о питании. */
  nutritionSlot?: ReactNode;
  client: ClientRecord;
  summary: ClientHomeSummary | null;
  onOpenAccounting: () => void;
  /** «Списать»: ручное списание одного занятия; промис завершается после commit. */
  onWriteOff: () => Promise<void>;
  /** «Отменить»: возврат списания `entryId`, которое тренер видел на экране. */
  onReturnLast: (entryId: string) => Promise<void>;
  /** Resolves only after the lifecycle commit; the caller leaves the workspace. */
  onArchive: () => Promise<void>;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState(false);
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);
  const creditLock = useRef(false);

  /** Одна операция учёта за раз: двойное нажатие не создаёт второе списание. */
  const runCredit = async (action: () => Promise<void>) => {
    if (creditLock.current) return;
    creditLock.current = true;
    setCreditBusy(true);
    setCreditError(null);
    try {
      await action();
    } catch (failure) {
      setCreditError(creditErrorText(failure));
    } finally {
      creditLock.current = false;
      setCreditBusy(false);
    }
  };

  const archive = async () => {
    if (archiving) return;
    setArchiving(true);
    try {
      await onArchive();
    } catch {
      setArchiveError(true);
      setConfirming(false);
      setArchiving(false);
    }
  };

  const pack = summary?.pack ?? null;

  return <PrototypeScreen compact scroll={false}>
    {daySlot}

    <View style={[styles.card, shadow.card, { backgroundColor: colors.surface }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={pack?.kind === "TRACKED" ? `Абонемент: доступно ${pack.available} из ${pack.granted} занятий. Открыть абонемент и оплату` : "Абонемент. Открыть абонемент и оплату"}
      onPress={onOpenAccounting} style={styles.cardBody}>
      <View style={styles.cardHead}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Абонемент</Text>
        {pack?.kind === "TRACKED" ? <StatusTag kind={toneKind[pack.tone]} label={toneLabel[pack.tone]} /> : null}
      </View>
      {pack?.kind === "TRACKED" ? <>
        <View style={styles.packLine}>
          <Text style={[styles.packNumber, { color: colors.textPrimary }]}>{pack.available}</Text>
          <Text style={[styles.packUnit, { color: colors.textSecondary }]}>{`из ${pack.granted} занятий`}</Text>
        </View>
        <ProgressBar value={pack.granted > 0 ? pack.available / pack.granted : null} accessibilityLabel={`Остаток: ${pack.available} из ${pack.granted} занятий`} />
      </> : null}
      <PackSummaryLine pack={pack} />
    </Pressable>
    {pack?.kind === "TRACKED" ? <View style={styles.creditActions}>
      <View style={styles.creditAction}><AppButton compact size="small" variant="secondary" label="Списать" busy={creditBusy}
        disabled={!pack.writeOffAvailable} disabledReason="Нет доступных занятий" accessibilityLabel="Списать одно занятие"
        onPress={() => { void runCredit(onWriteOff); }} /></View>
      <View style={styles.creditAction}><AppButton compact size="small" variant="secondary" label="Отменить" busy={creditBusy}
        disabled={pack.returnableDebitId === null} disabledReason="Нечего возвращать" accessibilityLabel="Отменить последнее списание"
        onPress={() => { const entryId = pack.returnableDebitId; if (entryId !== null) void runCredit(() => onReturnLast(entryId)); }} /></View>
    </View> : null}
    </View>
    {creditError !== null ? <InlineNotice kind="error">{creditError}</InlineNotice> : null}

    {nutritionSlot}

    {archiveError ? <InlineNotice kind="error">
      Не удалось переместить клиента в архив: карточка изменилась или операция не удалась. Данные не изменены.
    </InlineNotice> : null}
    <Pressable accessibilityRole="button" accessibilityLabel="Переместить в архив"
      onPress={() => { setArchiveError(false); setConfirming(true); }}
      style={({ pressed }) => [styles.archiveButton, { borderColor: colors.border, opacity: pressed ? 0.85 : 1 }]}>
      <Archive size={18} color={colors.textSecondary} strokeWidth={1.8} />
      <Text style={[styles.archiveText, { color: colors.textSecondary }]}>Переместить в архив</Text>
    </Pressable>
    <ConfirmDialog visible={confirming} confirmBusy={archiving}
      title={`Переместить ${client.displayName} в Архив?`}
      description="Клиент исчезнет из активного списка и появится в Архиве. Данные и записи календаря сохранятся. Клиента можно будет вернуть позже."
      confirmLabel="Архивировать"
      onCancel={() => setConfirming(false)} onConfirm={() => { void archive(); }} />
  </PrototypeScreen>;
}

const styles = StyleSheet.create({
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  card: { borderRadius: 26, padding: 14, gap: 10 },
  cardBody: { gap: 8 },
  archiveButton: { minHeight: 44, borderRadius: 22, borderWidth: 1.5, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  archiveText: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  packUnit: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  creditActions: { flexDirection: "row", gap: 8 },
  creditAction: { flex: 1 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { fontSize: 16, lineHeight: 21, fontFamily: fonts.bold },
  packLine: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  packNumber: { fontSize: 34, lineHeight: 40, fontFamily: fonts.bold },
});
