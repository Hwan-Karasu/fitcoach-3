import { StyleSheet, Text, View } from "react-native";
import type { BackupProgress, BackupRunTiming, BackupStage, PrepareStage } from "../../features/backup/public.ts";
import { ProgressBar } from "../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

const stageLabels: Readonly<Record<BackupStage, string>> = {
  SNAPSHOT: "Создаём снимок базы",
  CONTENT: "Проверяем данные",
  MEDIA: "Добавляем фото рецептов",
  VERIFY: "Проверяем целостность копии",
  PUBLISH: "Сохраняем файл в папку",
  ROTATE: "Обновляем список версий",
};
const shortLabels: Readonly<Record<BackupStage, string>> = {
  SNAPSHOT: "снимок", CONTENT: "данные", MEDIA: "фото", VERIFY: "проверка", PUBLISH: "запись", ROTATE: "версии",
};
const NBSP = String.fromCharCode(0xa0);
const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")}${NBSP}с`;

/** Текущий этап копии и прогресс (BKP-STAGE-1). Процент — только из посчитанных строк/фото; иначе индикатор без процента. */
export function BackupProgressView({ progress, fallback }: Readonly<{ progress: BackupProgress | null; fallback: string }>) {
  const { palette } = usePrototypeTheme();
  const known = progress !== null && progress.done !== null && progress.total !== null && progress.total > 0;
  const label = progress === null ? fallback : stageLabels[progress.stage];
  const detail = !known ? "" : progress.stage === "MEDIA" ? ` · ${progress.done} из ${progress.total}`
    : ` · ${Math.floor((progress.done! / progress.total!) * 100)}${NBSP}%`;
  return <View style={styles.progress} accessibilityLiveRegion="polite">
    <Text style={[styles.label, { color: palette.tokens.textSecondary }]}>{label}…{detail}</Text>
    <ProgressBar value={known ? progress.done! / progress.total! : null} accessibilityLabel={label} />
  </View>;
}

/** Итог: общее время и время этапов одной строкой мелким текстом. Повторные отрезки одного этапа складываются. */
export function BackupTimingText({ timing, prefix }: Readonly<{ timing: BackupRunTiming; prefix: string }>) {
  const { palette } = usePrototypeTheme();
  const totals = new Map<BackupStage, number>();
  for (const part of timing.stages) totals.set(part.stage, (totals.get(part.stage) ?? 0) + part.ms);
  const parts = [...totals].map(([stage, ms]) => `${shortLabels[stage]} ${seconds(ms)}`).join(" · ");
  return <View>
    <Text style={[styles.body, { color: palette.tokens.textSecondary }]}>{prefix} за {seconds(timing.totalMs)}.</Text>
    {parts ? <Text style={[styles.small, { color: palette.tokens.textMuted }]}>{parts}</Text> : null}
  </View>;
}

/** Код причины для обращения: без путей и данных клиентов. */
export function BackupErrorCode({ code, stage }: Readonly<{ code: string; stage: PrepareStage | null }>) {
  const { palette } = usePrototypeTheme();
  return <Text selectable style={[styles.small, { color: palette.tokens.textMuted }]}>Код: {code}{stage === null ? "" : ` · ${stage}`}</Text>;
}

const styles = StyleSheet.create({
  progress: { gap: 8 },
  label: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  body: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  small: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
});
