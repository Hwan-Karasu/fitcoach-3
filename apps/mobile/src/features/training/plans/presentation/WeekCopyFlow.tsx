import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetView, type BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { AppButton, ConfirmDialog, SelectionChip } from "../../../../shared/ui/components/public.ts";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { WeekCopyMode, WeekCopyPort, WeekCopyPreview, WeekCopyRequest } from "../domain/WeekCopy.ts";

type Source = "PLAN" | "WITH_DATA";
type Step = "choose" | "facts" | "overwrite" | null;

const sourceLabels: Readonly<Record<Source, string>> = { PLAN: "Без заполненных данных", WITH_DATA: "С заполненными данными" };

const failure = (error: unknown) => {
  const code = error instanceof Error ? error.message : "";
  return code === "COPY_PREVIEW_STALE" || code === "PROGRAM_REVISION_CONFLICT"
    ? "Программа или результаты изменились, пока шло копирование. Неделя не изменена — повторите."
    : code === "EXERCISE_PROFILE_UNAVAILABLE" ? "Не удалось прочитать профиль упражнения. Неделя не изменена."
      : "Не удалось скопировать неделю. Неделя не изменена.";
};

/**
 * Копирование недели внутри мезоцикла (§48.21, §48.24, §48.48), как в 2.0: «Скопировать из недели» →
 * «Без заполненных данных» / «С заполненными данными». Для данных — вопрос «Считать скопированные подходы
 * выполненными?» (Да/Нет/Отмена); если в целевой неделе есть результаты — предупреждение о перезаписи.
 * Только у этого клиента (§48.21.2 п. 6). Отмена на любом шаге ничего не меняет.
 */
export function WeekCopyFlow({ port, request, weeks, onClose, onDone }: Readonly<{
  port: WeekCopyPort;
  /** Целевая неделя, ревизия и мезоцикл; `null` — окно закрыто. Источник выбирается в окне. */
  request: Omit<WeekCopyRequest, "sourceWeek"> | null;
  weeks: readonly Readonly<{ index: number; caption: string | null }>[];
  onClose: () => void;
  onDone: (result: Readonly<{ ok: boolean; text: string }>) => void;
}>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const sheet = useRef<BottomSheetModal>(null);
  const [step, setStep] = useState<Step>(null);
  const [source, setSource] = useState<number | null>(null);
  const [kind, setKind] = useState<Source>("PLAN");
  const [preview, setPreview] = useState<WeekCopyPreview | null>(null);
  const [mode, setMode] = useState<WeekCopyMode>("PLAN");
  const [busy, setBusy] = useState(false);
  const continuing = useRef(false);

  useEffect(() => {
    if (request === null) return;
    continuing.current = false;
    setStep("choose"); setSource(null); setKind("PLAN"); setPreview(null); setMode("PLAN");
    sheet.current?.present();
  }, [request]);

  // Флаг «сценарий продолжается» живёт до конца сценария: закрытие окна выбора не должно его оборвать.
  const close = useCallback(() => { continuing.current = false; setStep(null); onClose(); }, [onClose]);
  const backdrop = useCallback((props: BottomSheetBackdropProps) => (
    <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
  ), []);

  if (request === null) return null;
  const full = (sourceWeek: number): WeekCopyRequest => ({ ...request, sourceWeek });

  const run = async (nextMode: WeekCopyMode, current: WeekCopyPreview, replaceExisting: boolean) => {
    if (source === null) return;
    setBusy(true);
    try {
      await port.copy(full(source), current.revisionToken, nextMode, replaceExisting);
      onDone({ ok: true, text: nextMode === "PLAN" ? `План недели ${source} скопирован в неделю ${request.targetWeek}.`
        : nextMode === "CONFIRM" ? `Неделя ${source} скопирована в неделю ${request.targetWeek}; заполненные подходы засчитаны как выполненные.`
          : `Неделя ${source} скопирована в неделю ${request.targetWeek}; значения перенесены как предварительные.` });
    } catch (error) {
      onDone({ ok: false, text: failure(error) });
    } finally {
      setBusy(false);
      close();
    }
  };

  /** После выбора режима: перезапись заполненной недели — только с явным согласием (§48.21.1 п. 7). */
  const proceed = (nextMode: WeekCopyMode, current: WeekCopyPreview) => {
    setMode(nextMode);
    if (current.targetSessions > 0) setStep("overwrite");
    else void run(nextMode, current, false);
  };

  const choose = async () => {
    if (source === null) return;
    continuing.current = true;
    sheet.current?.dismiss();
    setBusy(true);
    try {
      const current = await port.preview(full(source));
      setPreview(current);
      // Вопрос о выполнении — только если есть что засчитывать (§48.48.2 п. 2, 7).
      if (kind === "WITH_DATA" && current.sourceSets > 0) setStep("facts");
      else proceed("PLAN", current);
    } catch (error) {
      onDone({ ok: false, text: failure(error) });
      close();
    } finally {
      setBusy(false);
    }
  };

  return <>
    <BottomSheetModal ref={sheet} backdropComponent={backdrop} backgroundStyle={{ backgroundColor: colors.canvas }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}
      onDismiss={() => { if (!continuing.current) close(); }}>
      <BottomSheetView style={styles.sheet}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.textPrimary }]}>
          {`Скопировать в неделю ${request.targetWeek}`}
        </Text>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Из недели</Text>
        <View style={styles.chips}>
          {weeks.filter((week) => week.index !== request.targetWeek).map((week) => (
            <SelectionChip key={week.index} group="Из недели" selected={source === week.index}
              label={week.caption === null ? `Неделя ${week.index}` : `Неделя ${week.index} · ${week.caption}`}
              onPress={() => setSource(week.index)} />
          ))}
        </View>
        <Text style={[styles.label, { color: colors.textSecondary }]}>Как скопировать</Text>
        <View style={styles.chips}>
          {(["PLAN", "WITH_DATA"] as const).map((item) => (
            <SelectionChip key={item} group="Как скопировать" label={sourceLabels[item]} selected={kind === item}
              onPress={() => setKind(item)} />
          ))}
        </View>
        <Text style={[styles.note, { color: colors.textSecondary }]}>
          {source === null ? "Выберите неделю-источник." : `Неделя ${source} заменит неделю ${request.targetWeek}. Неделя ${source} не изменится.`}
        </Text>
        <View style={styles.row}>
          <View style={styles.grow}><AppButton variant="secondary" label="Отмена" onPress={() => sheet.current?.dismiss()} /></View>
          <View style={styles.grow}><AppButton label="Скопировать" busy={busy} disabled={source === null}
            onPress={() => { void choose(); }} /></View>
        </View>
      </BottomSheetView>
    </BottomSheetModal>
    <ConfirmDialog visible={step === "facts"} title="Считать скопированные подходы выполненными?"
      description={`«Да» — заполненные подходы станут новыми выполнениями недели ${request.targetWeek} и войдут в статистику. «Нет» — значения перенесутся как предварительные, без выполнения. Даты и итог тренировок не копируются.`}
      confirmLabel="Да" tertiaryLabel="Нет" cancelLabel="Отмена"
      onConfirm={() => { if (preview !== null) proceed("CONFIRM", preview); }}
      onTertiary={() => { if (preview !== null) proceed("PREFILL", preview); }}
      onCancel={close} />
    <ConfirmDialog visible={step === "overwrite"} destructive confirmBusy={busy} title={`Заменить неделю ${request.targetWeek}?`}
      description={`В неделе ${request.targetWeek} уже есть результаты: тренировок ${preview?.targetSessions ?? 0}, подходов ${preview?.targetSets ?? 0}, заметок ${preview?.targetNotes ?? 0}. Они будут удалены и заменены копией. Вернуть можно только из резервной копии.`}
      confirmLabel="Заменить" cancelLabel="Отмена"
      onConfirm={() => { if (preview !== null) void run(mode, preview, true); }}
      onCancel={close} />
  </>;
}

const styles = StyleSheet.create({
  sheet: { paddingHorizontal: 16, paddingBottom: 24, gap: 10 },
  title: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22 },
  label: { fontFamily: fonts.medium, fontSize: 12, lineHeight: 16, marginTop: 4 },
  note: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  row: { flexDirection: "row", gap: 10, marginTop: 6 },
  grow: { flex: 1 },
});
