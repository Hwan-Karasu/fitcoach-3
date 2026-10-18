import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AppButton, ConfirmDialog, EmptyState, InlineNotice, LoadingState } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import { templateSummary, type ProgramTemplate, type TemplatePayload } from "../domain/TemplateModel.ts";
import type { TrainingPlansRepositoryPort } from "../domain/TrainingPlansRepositoryPort.ts";

type SimplePayload = Extract<TemplatePayload, { kind: "SIMPLE" }>;

/**
 * Вкладка «Шаблоны» Простого конструктора (UI-OWN-026, как в 2.0): шаблоны Простой программы; «Применить» после
 * подтверждения заменяет черновик конструктора (§48.14.2: план и число недель, новые ID). Сохранение — как обычно.
 */
export function SimpleTemplatesPanel({ repository, reloadKey, onApply }: Readonly<{
  repository: TrainingPlansRepositoryPort;
  /** Меняется после «В шаблон» — список перечитывается. */
  reloadKey: number;
  onApply: (title: string, payload: SimplePayload) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [templates, setTemplates] = useState<readonly ProgramTemplate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [applying, setApplying] = useState<ProgramTemplate | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    repository.listTemplates()
      .then((all) => { if (active) setTemplates(all.filter((template) => template.kind === "SIMPLE")); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [repository, reloadKey]);

  if (failed) return <InlineNotice kind="error">Шаблоны не загрузились. Черновик не изменён.</InlineNotice>;
  if (templates === null) return <LoadingState label="Открываем шаблоны…" />;
  if (templates.length === 0) {
    return <EmptyState reason="no-data" title="Шаблонов пока нет"
      body="Соберите программу на вкладке «Программа» и нажмите «В шаблон»." />;
  }
  return (
    <View style={styles.list}>
      {templates.map((template) => (
        <View key={template.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text numberOfLines={2} style={[styles.title, { color: colors.textPrimary }]}>{template.title}</Text>
          <Text style={[styles.meta, { color: colors.textSecondary }]}>{templateSummary(template.payload)}</Text>
          <AppButton compact variant="secondary" label="Применить" accessibilityLabel={`Применить шаблон ${template.title}`}
            onPress={() => setApplying(template)} />
        </View>
      ))}
      <ConfirmDialog visible={applying !== null} title="Применить шаблон?"
        description="Текущий черновик программы будет заменён. Сохранение — кнопкой внизу вкладки «Программа»."
        confirmLabel="Применить" onCancel={() => setApplying(null)}
        onConfirm={() => {
          if (applying !== null && applying.payload.kind === "SIMPLE") onApply(applying.title, applying.payload);
          setApplying(null);
        }} />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  title: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 18 },
  meta: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
