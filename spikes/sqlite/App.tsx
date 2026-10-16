import { useCallback, useState } from "react";
import { Button, SafeAreaView, ScrollView, Text } from "react-native";
import { runSqliteSpike, type SpikeReport } from "./src/runSqliteSpike";

export default function App() {
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
