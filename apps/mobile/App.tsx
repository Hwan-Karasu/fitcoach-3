import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet } from "react-native";
import { useFonts } from "expo-font";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ApplicationBootGate } from "./src/app/bootstrap/ApplicationBootGate.tsx";
import { createDevRuntime } from "./src/app/composition/createDevRuntime.ts";
import { createProductionRuntime } from "./src/app/composition/createProductionRuntime.ts";
import { fontAssets } from "./src/shared/ui/theme/fontAssets.ts";
import { revealNativeContent } from "./src/app/bootstrap/nativeSplash.ts";
import { LAUNCH_BACKGROUND } from "./src/app/bootstrap/launchTimeline.ts";
import { startupDiagnostics } from "./src/app/bootstrap/StartupDiagnostics.ts";

function ApplicationEntry({ fontsReady, firstFrameReady }: Readonly<{ fontsReady: boolean; firstFrameReady: boolean }>) {
  const [runtime] = useState(() => __DEV__ ? createDevRuntime() : createProductionRuntime());
  return <ApplicationBootGate {...runtime} fontsReady={fontsReady} firstFrameReady={firstFrameReady} />;
}

export default function App() {
  // Если шрифт не загрузился, работаем на системном, а не блокируем приложение.
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const fontsReady = fontsLoaded || fontError !== null;
  const [firstFrameReady, setFirstFrameReady] = useState(false);
  const layoutSeen = useRef(false);
  const frame = useRef<number | null>(null);
  const onLayout = useCallback(() => {
    if (layoutSeen.current) return;
    layoutSeen.current = true;
    startupDiagnostics.mark("react.layout");
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      void revealNativeContent();
      setFirstFrameReady(true);
    });
  }, []);
  useEffect(() => { if (fontsReady) startupDiagnostics.mark("fonts.ready"); }, [fontsReady]);
  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    layoutSeen.current = false;
  }, []);
  return (
    <GestureHandlerRootView style={styles.root} onLayout={onLayout}>
      <ApplicationEntry fontsReady={fontsReady} firstFrameReady={firstFrameReady} />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: LAUNCH_BACKGROUND } });
