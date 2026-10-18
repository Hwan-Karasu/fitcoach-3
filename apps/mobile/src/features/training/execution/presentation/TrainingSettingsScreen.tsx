import { useCallback, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Check } from "lucide-react-native";
import { InlineNotice, LoadingState } from "../../../../shared/ui/components/public.ts";
import { PrototypeScreen, SectionHeading } from "../../../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../../../shared/ui/theme/typography.ts";
import type { ConfirmationMode } from "../domain/ExecutionModel.ts";
import type { TrainingExecutionPort } from "../domain/TrainingExecutionPort.ts";

const modes: readonly Readonly<{ mode: ConfirmationMode; title: string; detail: string }>[] = [
  { mode: "AUTO", title: "Автоматически",
    detail: "Подход засчитывается, когда заполнены вес и повторы (или время). Галочки нет, таймер отдыха стартует сам." },
  { mode: "MANUAL", title: "Вручную",
    detail: "Цифры можно вписать заранее; подход засчитывается галочкой справа. Таймер стартует от галочки." },
];

/**
 * Способ подтверждения подхода (§48.48, §48.53–48.54): одна общая настройка тренера для дневников всех клиентов,
 * по умолчанию — автоматически. Смена режима не переписывает уже засчитанные и подготовленные подходы.
 */
export function TrainingSettingsScreen({ execution }: Readonly<{ execution: TrainingExecutionPort }>) {
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;
  const [mode, setMode] = useState<ConfirmationMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    execution.getConfirmationMode().then((next) => { if (active) setMode(next); })
      .catch(() => { if (active) setError("Не удалось загрузить настройку."); });
    return () => { active = false; };
  }, [execution]));

  const choose = (next: ConfirmationMode) => {
    if (next === mode) return;
    const before = mode;
    setMode(next);
    setError(null);
    execution.setConfirmationMode(next).catch(() => {
      setMode(before);
      setError("Не удалось сохранить. Режим не изменён — повторите.");
    });
  };

  if (mode === null && error === null) return <PrototypeScreen><LoadingState label="Загружаем…" /></PrototypeScreen>;
  return (
    <PrototypeScreen>
      <SectionHeading>Как засчитывать подход</SectionHeading>
      {error !== null ? <InlineNotice kind="error">{error}</InlineNotice> : null}
      {modes.map((item) => {
        const selected = item.mode === mode;
        return (
          <Pressable key={item.mode} accessibilityRole="radio" accessibilityState={{ checked: selected }}
            accessibilityLabel={`${item.title}. ${item.detail}`} onPress={() => choose(item.mode)}
            style={[styles.option, { backgroundColor: colors.surface, borderColor: selected ? colors.accentFill : colors.border }]}>
            <View style={styles.text}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{item.title}</Text>
              <Text style={[styles.detail, { color: colors.textSecondary }]}>{item.detail}</Text>
            </View>
            {selected ? <Check size={22} color={colors.accentInk} strokeWidth={2.2} /> : null}
          </Pressable>
        );
      })}
      <Text style={[styles.detail, { color: colors.textMuted }]}>
        Одна настройка для всех клиентов. Уже засчитанные подходы и заранее вписанные цифры при смене не меняются.
      </Text>
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  option: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, borderRadius: 12, padding: 14, minHeight: 64 },
  text: { flex: 1, gap: 4 },
  title: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  detail: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
});
