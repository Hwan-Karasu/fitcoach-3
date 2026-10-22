import { useCallback, useEffect, useState } from "react";
import { Button, SafeAreaView, ScrollView, Text } from "react-native";
import { runSqliteSpike, type SpikeReport } from "./src/runSqliteSpike";
import { runR06NativeProbe, type R06NativeReport } from "../../apps/mobile/src/app/composition/runR06NativeProbe.ts";

export default function App() {
  return process.env.EXPO_PUBLIC_R06_BACKUP === "1" ? <BackupProbe /> : <SqliteProbe />;
}

function BackupProbe() {
  const [report, setReport] = useState<R06NativeReport | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const mode = process.env.EXPO_PUBLIC_R06_PHASE === "INTERRUPT" ? "INTERRUPT" : process.env.EXPO_PUBLIC_R06_PHASE === "RECOVER" ? "RECOVER" : "NORMAL";
    void runR06NativeProbe(mode).then((value) => {
      setReport(value); console.info(`R06_REPORT ${JSON.stringify(value)}`);
    }).catch(() => { setFailed(true); console.info("R06_REPORT FAILED"); });
  }, []);
  return <SafeAreaView style={{ flex: 1, padding: 20 }}><ScrollView>
    <Text>R06 — только синтетические SQLite-файлы</Text>
    <Text selectable>{report ? JSON.stringify(report, null, 2) : failed ? "R06_NATIVE_FAILED" : "Проверка…"}</Text>
  </ScrollView></SafeAreaView>;
}

function SqliteProbe() {
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<SpikeReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setRunning(true);
    setReport(null);
    setError(null);
    try {
      setReport(await runSqliteSpike());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, padding: 20, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>SQLite R07 spike</Text>
      <Button
        title={running ? "Проверка выполняется…" : "Запустить проверки"}
        disabled={running}
        onPress={() => void run()}
      />
      <ScrollView>
        {error ? <Text selectable>Ошибка: {error}</Text> : null}
        {report ? (
          <Text selectable>{JSON.stringify(report, null, 2)}</Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
