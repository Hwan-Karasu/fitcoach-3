import { useState } from "react";
import { StyleSheet } from "react-native";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import FoundationScreen from "./src/app/bootstrap/FoundationScreen";
import { DevBootGate } from "./src/app/bootstrap/DevBootGate.tsx";
import { createDevRuntime } from "./src/app/composition/createDevServices.ts";
import { fontAssets } from "./src/shared/ui/theme/fontAssets.ts";

function DevEntry() {
  const [runtime] = useState(createDevRuntime);
  return <DevBootGate {...runtime} />;
}

export default function App() {
  // Если шрифт не загрузился, работаем на системном, а не блокируем приложение.
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  if (!fontsLoaded && fontError === null) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      {__DEV__ ? <DevEntry /> : <FoundationScreen />}
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
