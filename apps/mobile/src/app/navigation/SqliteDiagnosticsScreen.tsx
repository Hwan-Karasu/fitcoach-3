import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { F04ProbeReport } from "../diagnostics/runF04Probe.ts";
import { AppButton } from "../../shared/ui/components/public.ts";
import { PrototypeNotice, PrototypeScreen } from "../../shared/ui/prototype/ScreenPieces.tsx";
import { usePrototypeTheme } from "../../shared/ui/theme/PrototypeThemeProvider.tsx";
import { fonts } from "../../shared/ui/theme/typography.ts";

export function SqliteDiagnosticsScreen({ runProbe }: Readonly<{ runProbe: () => Promise<F04ProbeReport> }>) {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<F04ProbeReport | null>(null);
  const { palette } = usePrototypeTheme();
  const colors = palette.tokens;

  const run = async () => {
    if (running) return;
    setRunning(true);
    setReport(null);
    try { setReport(await runProbe()); }
    catch { setReport({ checks: [{ name: "Закрытие тестовой базы", passed: false }], allPassed: false,
      transactions: { committed: 0, rolledBack: 0, rejected: 0 } }); }
    finally { setRunning(false); }
  };

  return (
    <PrototypeScreen description="F04 · dev-проверка на отдельной синтетической SQLite-базе">
      <PrototypeNotice>Рабочая база и карточки клиентов не затрагиваются. Это техническая проверка, не экран приложения.</PrototypeNotice>
      <AppButton label={running ? "Проверка…" : "Запустить проверку SQLite"} onPress={() => { void run(); }} disabled={running} />
      {report ? (
        <View style={styles.results}>
          <Text accessibilityRole="header" style={[styles.summary, { color: report.allPassed ? colors.accentInk : colors.textPrimary }]}>
            {report.allPassed ? "Проверки пройдены" : "Проверка не пройдена"}
          </Text>
          {report.checks.map((check) => (
            <Text key={check.name} style={[styles.row, { color: colors.textPrimary }]}>
              {check.passed ? "✓" : "×"} {check.name}
            </Text>
          ))}
          <Text style={[styles.row, { color: colors.textPrimary }]}>
            Транзакции: {report.transactions.committed} подтверждено, {report.transactions.rolledBack} откат,
            {" "}{report.transactions.rejected} отклонено
          </Text>
        </View>
      ) : null}
    </PrototypeScreen>
  );
}

const styles = StyleSheet.create({
  results: { gap: 8, marginTop: 12 },
  summary: { fontSize: 18, lineHeight: 24, fontFamily: fonts.bold },
  row: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 },
});
