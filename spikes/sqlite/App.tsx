import { useCallback, useEffect, useState } from "react";
import { Button, SafeAreaView, ScrollView, Text } from "react-native";
import { runSqliteSpike, type SpikeReport } from "./src/runSqliteSpike";
import { runR06NativeProbe, type R06NativeReport } from "../../apps/mobile/src/app/composition/runR06NativeProbe.ts";
import { runR06AutomaticProbe } from "../../apps/mobile/src/app/composition/runR06AutomaticProbe.ts";
import { chooseR06PublicationDirectory, runR06PublicationProbe, savedR06PublicationDirectory,
  verifyR06PickedPublication, type R06PublicationReport } from "../../apps/mobile/src/app/composition/runR06PublicationProbe.ts";

export default function App() {
  if (process.env.EXPO_PUBLIC_R06_PUBLICATION === "1") return <PublicationProbe />;
  return process.env.EXPO_PUBLIC_R06_BACKUP === "1" ? <BackupProbe /> : <SqliteProbe />;
}

function PublicationProbe() {
  const [report, setReport] = useState<R06PublicationReport | R06NativeReport | null>(null);
  const [busy, setBusy] = useState(false); const [failed, setFailed] = useState(false);
  const expectedFilename = (report && "filename" in report ? report.filename : undefined) ?? process.env.EXPO_PUBLIC_R06_PUBLICATION_FILENAME;
  const run = (task: () => Promise<R06PublicationReport | R06NativeReport>) => {
    if (busy) return;
    setBusy(true); setFailed(false);
    void task().then((value) => { setReport(value); console.info(`${value.kind === "R06_NATIVE" ? "R06_REPORT" : "R06_PUBLICATION_REPORT"} ${JSON.stringify(value)}`); })
      .catch(() => { setFailed(true); console.info("R06_PUBLICATION_REPORT FAILED"); }).finally(() => setBusy(false));
  };
  return <SafeAreaView style={{ flex: 1, padding: 20 }}><ScrollView>
    <Text>R06 — синтетические копии. Приложение 2.0 не изменяется.</Text>
    <Button title="Проверить Загрузки" disabled={busy} onPress={() => run(() => runR06PublicationProbe({ kind: "DOWNLOADS" }))} />
    <Button title="Выбрать тестовую папку и проверить SAF" disabled={busy} onPress={() => run(async () => {
      await chooseR06PublicationDirectory(); return runR06PublicationProbe(await savedR06PublicationDirectory());
    })} />
    <Button title="Повторить SAF без выбора папки" disabled={busy} onPress={() => run(async () => runR06PublicationProbe(await savedR06PublicationDirectory()))} />
    <Button title="Проверить тестовую копию через выбор файла" disabled={busy || !expectedFilename} onPress={() => run(() => verifyR06PickedPublication(expectedFilename!))} />
    <Button title="Проверить журнал и восстановление" disabled={busy} onPress={() => run(() => runR06NativeProbe())} />
    <Button title="Подготовить прерывание восстановления" disabled={busy} onPress={() => run(() => runR06NativeProbe("INTERRUPT"))} />
    <Button title="Прервать перед закреплением точки возврата" disabled={busy} onPress={() => run(() => runR06NativeProbe("INTERRUPT_FINALIZATION"))} />
    <Button title="Восстановить после прерывания" disabled={busy} onPress={() => run(() => runR06NativeProbe("RECOVER"))} />
    <Button title="Проверить действия восстановления" disabled={busy} onPress={() => run(() => runR06NativeProbe("ACTIONS"))} />
    <Button title="Проверить только повтор восстановления" disabled={busy} onPress={() => run(() => runR06NativeProbe("ACTIONS_RECOVERY"))} />
    <Button title="Проверить автоматические копии" disabled={busy} onPress={() => run(() => runR06AutomaticProbe())} />
    <Button title="Проверить только статус автокопий" disabled={busy} onPress={() => run(() => runR06AutomaticProbe("STATUS"))} />
    <Text selectable>{busy ? "Проверка…" : failed ? "R06_PUBLICATION_FAILED" : report ? JSON.stringify(report, null, 2) : "Готово к проверке"}</Text>
  </ScrollView></SafeAreaView>;
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
