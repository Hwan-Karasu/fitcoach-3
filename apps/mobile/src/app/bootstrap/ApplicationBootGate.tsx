import { useEffect, useState } from "react";
import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { ApplicationRuntime } from "../composition/createServices.ts";
import { PrototypeShell } from "../navigation/PrototypeShell.tsx";
import type { BootErrorCode } from "./BootCoordinator.ts";
import { fonts } from "../../shared/ui/theme/typography.ts";

const errorLabels: Record<BootErrorCode, string> = {
  WORKSPACE_UNAVAILABLE: "Не удалось открыть локальные данные.",
  DB_UNAVAILABLE: "Локальная база недоступна.",
  DATABASE_INCOMPATIBLE: "Не удалось открыть этот файл данных. Исходные данные сохранены.",
  DATABASE_NEWER: "Эти данные созданы более новой версией приложения. Обновите «Дневник атлета».",
  MIGRATION_INCOMPLETE: "Проверка локальной базы не завершена.",
  PREFERENCES_UNAVAILABLE: "Настройки отображения недоступны.",
  THEME_UNAVAILABLE: "Тема оформления недоступна.",
};

/** Screens receive repositories only after the critical database gate succeeds. */
export function ApplicationBootGate({ boot, services, development }: Readonly<ApplicationRuntime>) {
  const [state, setState] = useState(boot.state);

  useEffect(() => {
    const unsubscribe = boot.subscribe(setState);
    void boot.start();
    return unsubscribe;
  }, [boot]);

  if (state.kind === "APP_READY") return <PrototypeShell services={services}
    workspaceId={state.workspaceId} />;
  const failed = state.kind === "BOOT_FAILED";
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />
        <View style={styles.content}>
          <Text style={styles.label}>{development ? "ДНЕВНИК АТЛЕТА · РАЗРАБОТКА" : "ДНЕВНИК АТЛЕТА"}</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {failed ? "Запуск не завершён" : "Подготовка приложения"}
          </Text>
          <Text style={styles.body}>
            {failed ? errorLabels[state.code] : "Открываем локальную базу клиентов и проверяем тему оформления."}
          </Text>
          {development ? <Text style={styles.note}>Данные прежней версии сохраняются. Резервное копирование тестового хранилища ещё не подключено.</Text> : null}
          {failed ? (
            <Pressable accessibilityRole="button" onPress={() => { void boot.retry(); }} style={styles.button}>
              <Text style={styles.buttonLabel}>Повторить</Text>
            </Pressable>
          ) : null}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f7fa" },
  content: { flex: 1, justifyContent: "center", paddingHorizontal: 28, gap: 18 },
  label: { color: "#40688b", fontSize: 12, fontFamily: fonts.bold, letterSpacing: 1.4 },
  title: { color: "#162b3c", fontSize: 20, fontFamily: fonts.bold },
  body: { color: "#345067", fontFamily: fonts.regular, fontSize: 14, lineHeight: 22 },
  note: { color: "#718397", fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  button: { minHeight: 48, alignSelf: "flex-start", justifyContent: "center", paddingHorizontal: 20,
    borderRadius: 12, backgroundColor: "#166d83" },
  buttonLabel: { color: "#ffffff", fontSize: 14, fontFamily: fonts.bold },
});
