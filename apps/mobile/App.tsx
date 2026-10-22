import { useState } from "react";
import { StyleSheet } from "react-native";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ApplicationBootGate } from "./src/app/bootstrap/ApplicationBootGate.tsx";
import { createDevRuntime } from "./src/app/composition/createDevRuntime.ts";
import { createProductionRuntime } from "./src/app/composition/createProductionRuntime.ts";
import { fontAssets } from "./src/shared/ui/theme/fontAssets.ts";

function ApplicationEntry() {
  const [runtime] = useState(() => __DEV__ ? createDevRuntime() : createProductionRuntime());
  return <ApplicationBootGate {...runtime} />;
}

export default function App() {
  // Если шрифт не загрузился, работаем на системном, а не блокируем приложение.
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  if (!fontsLoaded && fontError === null) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <ApplicationEntry />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
