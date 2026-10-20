import { useState, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, StatusTag } from
  "../../../shared/ui/components/public.ts";
import { PrototypeScreen } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ClientHomeSummary, HomePackSummary } from "../domain/ClientHomeSummary.ts";
import type { ClientRecord } from "../domain/ClientRepositoryPort.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const toneLabel = { active: "Активен", warning: "Подходит к концу", empty: "Закончился" } as const;
const toneKind = { active: "success", warning: "warning", empty: "action_required" } as const;

function formatIsoDate(date: string): string {
  return `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`;
}

function PackBody({ pack }: Readonly<{ pack: HomePackSummary | null }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const line = (text: string) => <Text style={[styles.detail, { color: colors.textSecondary }]}>{text}</Text>;
  if (pack === null) return line("Загружаем…");
  if (pack.kind === "UNAVAILABLE") return line("Сводка абонемента не загрузилась. Данные учёта не изменены.");
  if (pack.kind === "NOT_TRACKED") return line(`${pack.label}. Запись в календарь доступна без пакета.`);
  if (pack.kind === "NO_PACK") return line("Пакетов нет. Добавьте пакет или записывайте без списания.");
  const extra = [pack.pricePerSession !== null ? `Цена: ${pack.pricePerSession}` : null, pack.expiresOn !== null ? `до ${formatIsoDate(pack.expiresOn)}` : null].filter((part) => part !== null).join(" · ");
  return <>
    <View style={styles.packLine}>
      <Text accessibilityLabel={`Доступно ${pack.available} из ${pack.granted} занятий`} style={[styles.packNumber, { color: colors.textPrimary }]}>{`${pack.available}/${pack.granted}`}</Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>доступно</Text>
    </View>
    {extra !== "" ? line(extra) : null}
  </>;
}

/**
 * Client Home (UX 2.0): identity header with the edit pencil, abonement first, then the nutrition blocks (day data and КБЖУ, supplied by the shell), archive last —
 * all projections of their owners' facts; no invented dashboard blocks.
 */
export function ClientHomePreview({ client, summary, onOpenAccounting, nutritionSlot,
  onArchive }: Readonly<{
  /** Блоки питания (шаги, КБЖУ) — проекция Nutrition, подставляется оболочкой; Clients не знает о питании. */
  nutritionSlot?: ReactNode;
  client: ClientRecord;
  summary: ClientHomeSummary | null;
  onOpenAccounting: () => void;
  /** Resolves only after the lifecycle commit; the caller leaves the workspace. */
  onArchive: () => Promise<void>;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState(false);

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

  return <PrototypeScreen>

    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHead}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Абонемент</Text>
        {pack?.kind === "TRACKED" ? <StatusTag kind={toneKind[pack.tone]} label={toneLabel[pack.tone]} /> : null}
      </View>
      <PackBody pack={pack} />
      <AppButton variant="secondary" label="Абонемент и оплата" onPress={onOpenAccounting} />
    </View>

    {nutritionSlot}

    {archiveError ? <InlineNotice kind="error">
      Не удалось переместить клиента в архив: карточка изменилась или операция не удалась. Данные не изменены.
    </InlineNotice> : null}
    <AppButton variant="ghost" label="Переместить в архив"
      onPress={() => { setArchiveError(false); setConfirming(true); }} />
    <ConfirmDialog visible={confirming} confirmBusy={archiving}
      title={`Переместить ${client.displayName} в Архив?`}
      description="Клиент исчезнет из активного списка и появится в Архиве. Данные и записи календаря сохранятся. Клиента можно будет вернуть позже."
      confirmLabel="Архивировать"
      onCancel={() => setConfirming(false)} onConfirm={() => { void archive(); }} />
  </PrototypeScreen>;
}

const styles = StyleSheet.create({
  hero: { borderWidth: 1, borderRadius: 16, padding: 10, flexDirection: "row", gap: 10, alignItems: "center" },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 16, lineHeight: 22, fontFamily: fonts.bold },
  heroText: { flex: 1, gap: 2 },
  name: { fontSize: 15, lineHeight: 20, fontFamily: fonts.bold },
  detail: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: 100 },
  card: { borderWidth: 1, borderRadius: 14, padding: 10, gap: 6 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { fontSize: 14, lineHeight: 19, fontFamily: fonts.bold },
  weightRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  weightField: { flex: 1 },
  packLine: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  packNumber: { fontSize: 22, lineHeight: 28, fontFamily: fonts.bold },
});
