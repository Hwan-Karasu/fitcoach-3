import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice, MetricTile, StatusTag, TextField } from
  "../../../shared/ui/components/public.ts";
import { PrototypeScreen } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ClientHomeSummary, HomePackSummary } from "../domain/ClientHomeSummary.ts";
import type { ClientRecord } from "../domain/ClientRepositoryPort.ts";
import { formatHeightCmX10 } from "../domain/ClientProfileValidation.ts";
import { ageOn, formatYears, localCalendarDate } from "../domain/ClientRosterPresentation.ts";
import { fonts } from "../../../shared/ui/theme/typography.ts";

const toneLabel = { active: "Активен", warning: "Подходит к концу", empty: "Закончился" } as const;
const toneKind = { active: "success", warning: "warning", empty: "action_required" } as const;

function initials(name: string): string {
  return name.split(/\s+/u).filter(Boolean).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase("ru") ?? "").join("");
}

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
  return <>
    <View style={styles.packLine}>
      <Text style={[styles.packNumber, { color: colors.textPrimary }]}>{pack.available}</Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        {`доступно${pack.reserved > 0 ? ` · ещё ${pack.reserved} в резерве за записями` : ""}`}
      </Text>
    </View>
    {pack.pricePerSession !== null ? line(`Цена тренировки: ${pack.pricePerSession}`) : null}
    {pack.expiresOn !== null ? line(`Действует до ${formatIsoDate(pack.expiresOn)}`) : null}
  </>;
}

/**
 * Client Home in the new layout (§§51, 53.4): identity, the approved stat tiles, weight entry and the
 * abonement summary — all projections of their owners' facts; no invented dashboard blocks.
 */
export function ClientHomePreview({ client, summary, onEdit, onOpenAccounting, onOpenMeasurements, onRecordWeight,
  onArchive }: Readonly<{
  client: ClientRecord;
  summary: ClientHomeSummary | null;
  onEdit: () => void;
  onOpenAccounting: () => void;
  onOpenMeasurements: () => void;
  /** Creates one Body Weight measurement (§10.13.1); resolves to an error text or null. */
  onRecordWeight: (value: string) => Promise<string | null>;
  /** Resolves only after the lifecycle commit; the caller leaves the workspace. */
  onArchive: () => Promise<void>;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [confirming, setConfirming] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState(false);
  const [weight, setWeight] = useState("");
  const [weightBusy, setWeightBusy] = useState(false);
  const [weightError, setWeightError] = useState<string | null>(null);
  const [weightSaved, setWeightSaved] = useState(false);

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

  const recordWeight = async () => {
    if (weightBusy) return;
    setWeightBusy(true);
    setWeightSaved(false);
    const failure = await onRecordWeight(weight);
    setWeightError(failure);
    if (failure === null) { setWeight(""); setWeightSaved(true); }
    setWeightBusy(false);
  };

  const age = client.birthDate === null ? null : ageOn(client.birthDate, localCalendarDate(new Date()));
  const meta = [age === null ? null : formatYears(age),
    client.heightCmX10 === null ? null : `${formatHeightCmX10(client.heightCmX10)} см`].filter(Boolean).join(" · ");
  const pack = summary?.pack ?? null;

  return <PrototypeScreen>
    <View style={[styles.hero, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={[styles.avatar, { backgroundColor: colors.accentFill }]}>
        <Text style={[styles.avatarText, { color: colors.onAccentFill }]}>{client.emoji ?? initials(client.displayName)}</Text>
      </View>
      <View style={styles.heroText}>
        <Text style={[styles.name, { color: colors.textPrimary }]}>{client.displayName}</Text>
        <Text style={[styles.detail, { color: colors.textSecondary }]}>{meta || "Возраст и рост не указаны"}</Text>
        {client.contactPhone ? <Text style={[styles.detail, { color: colors.textSecondary }]}>{client.contactPhone}</Text> : null}
        {client.contactEmail ? <Text style={[styles.detail, { color: colors.textSecondary }]}>{client.contactEmail}</Text> : null}
      </View>
    </View>
    <AppButton variant="ghost" label="Редактировать карточку" onPress={onEdit} />

    <View style={styles.tiles}>
      {(summary?.metrics ?? [{ label: "Вес", value: null }, { label: "% жира", value: null },
        { label: "Трен./нед.", value: null }]).map((metric) => (
        <View key={metric.label} style={styles.tile}>
          <MetricTile label={metric.label} value={metric.value} unit={metric.unit} status={metric.status} />
        </View>
      ))}
    </View>

    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Вес сегодня</Text>
      <View style={styles.weightRow}>
        <View style={styles.weightField}>
          <TextField label="Вес, кг" value={weight} keyboardType="decimal-pad" placeholder="Например, 80,1"
            onChangeText={(value) => { setWeight(value); setWeightSaved(false); }} />
        </View>
        <AppButton label="Записать" busy={weightBusy} disabled={weight.trim() === ""}
          onPress={() => { void recordWeight(); }} />
      </View>
      {weightError !== null ? <InlineNotice kind="error">{weightError}</InlineNotice> : null}
      {weightSaved ? <Text style={[styles.detail, { color: colors.success }]}>Записано в замеры.</Text> : null}
      <AppButton variant="ghost" label="Все замеры" onPress={onOpenMeasurements} />
    </View>

    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHead}>
        <Text style={[styles.cardTitle, { color: colors.textPrimary }]}>Абонемент</Text>
        {pack?.kind === "TRACKED" ? <StatusTag kind={toneKind[pack.tone]} label={toneLabel[pack.tone]} /> : null}
      </View>
      <PackBody pack={pack} />
      <AppButton variant="secondary" label="Абонемент и оплата" onPress={onOpenAccounting} />
    </View>

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
  hero: { borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: "row", gap: 14, alignItems: "center" },
  avatar: { width: 60, height: 60, borderRadius: 30, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 20, lineHeight: 26, fontFamily: fonts.bold },
  heroText: { flex: 1, gap: 2 },
  name: { fontSize: 18, lineHeight: 23, fontFamily: fonts.bold },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tile: { flexGrow: 1, flexBasis: 100 },
  card: { borderWidth: 1, borderRadius: 16, padding: 16, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { fontSize: 15, lineHeight: 22, fontFamily: fonts.bold },
  weightRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  weightField: { flex: 1 },
  packLine: { flexDirection: "row", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
  packNumber: { fontSize: 28, lineHeight: 34, fontFamily: fonts.bold },
});
