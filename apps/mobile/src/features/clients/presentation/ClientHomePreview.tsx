import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, InlineNotice } from "../../../shared/ui/components/public.ts";
import { PrototypeScreen } from "../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import type { ClientRecord } from "../domain/ClientRepositoryPort.ts";
import { formatHeightCmX10 } from "../domain/ClientProfileValidation.ts";

export function ClientHomePreview({ client, onEdit, onOpenAccounting, onOpenMeasurements, onArchive }: Readonly<{
  client: ClientRecord;
  onEdit: () => void;
  onOpenAccounting: () => void;
  onOpenMeasurements: () => void;
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

  return <PrototypeScreen>
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.name, { color: colors.textPrimary }]}>{client.emoji ? `${client.emoji}  ` : ""}{client.displayName}</Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        {client.birthDate ? `Дата рождения: ${client.birthDate}` : "Дата рождения не указана"}
      </Text>
      <Text style={[styles.detail, { color: colors.textSecondary }]}>
        {client.heightCmX10 === null ? "Рост не указан" : `Рост: ${formatHeightCmX10(client.heightCmX10)} см`}
      </Text>
      {client.contactPhone ? <Text style={[styles.detail, { color: colors.textSecondary }]}>
        Телефон: {client.contactPhone}
      </Text> : null}
      {client.contactEmail ? <Text style={[styles.detail, { color: colors.textSecondary }]}>
        E-mail: {client.contactEmail}
      </Text> : null}
      <AppButton variant="secondary" label="Редактировать карточку" onPress={onEdit} />
    </View>
    <AppButton variant="secondary" label="Абонемент и оплата" onPress={onOpenAccounting} />
    <AppButton variant="secondary" label="Замеры" onPress={onOpenMeasurements} />
    <InlineNotice kind="info">
      Данные клиента сохранены локально. Питание и тренировки подключаются отдельными модулями; пустые показатели здесь не заменены нулями.
    </InlineNotice>
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
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 10 },
  name: { fontSize: 23, lineHeight: 30, fontWeight: "700" },
  detail: { fontSize: 14, lineHeight: 20 },
});
