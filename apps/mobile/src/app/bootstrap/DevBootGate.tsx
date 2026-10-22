import { useEffect, useState } from "react";
import { Pressable, StatusBar, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import type { DevRuntime } from "../composition/createDevServices.ts";
import { PrototypeShell } from "../navigation/PrototypeShell.tsx";
import type { BootErrorCode } from "./BootCoordinator.ts";
import { fonts } from "../../shared/ui/theme/typography.ts";

const errorLabels: Record<BootErrorCode, string> = {
  WORKSPACE_UNAVAILABLE: "Тестовое рабочее пространство недоступно.",
  DB_UNAVAILABLE: "Локальная база недоступна.",
  MIGRATION_INCOMPLETE: "Проверка локальной базы не завершена.",
  PREFERENCES_UNAVAILABLE: "Настройки отображения недоступны.",
  THEME_UNAVAILABLE: "Тема оформления недоступна.",
};

/** Dev-only boot. Client writes use an isolated candidate DB, never the v2 source. */
export function DevBootGate({ boot, services }: Readonly<DevRuntime>) {
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
          <Text style={styles.label}>ДНЕВНИК АТЛЕТА · РАЗРАБОТКА</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {failed ? "Запуск не завершён" : "Подготовка приложения"}
          </Text>
          <Text style={styles.body}>
            {failed ? errorLabels[state.code] : "Открываем локальную базу клиентов и проверяем тему оформления."}
          </Text>
          <Text style={styles.note}>База версии 2.0 не затрагивается. Данные этого dev-хранилища пока не защищены бэкапом.</Text>
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
