import * as SplashScreen from "expo-splash-screen";
import { startupDiagnostics } from "./StartupDiagnostics.ts";

// Imported before the application module tree; auto-hide must be disabled outside React effects.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export async function revealNativeContent(): Promise<void> {
  try {
    // The library's Android default adds a 400 ms native fade over the React sequence.
    SplashScreen.setOptions({ duration: 0, fade: false });
    await SplashScreen.hideAsync();
    startupDiagnostics.mark("native.hidden");
  }
  catch { /* Expo Go / an interrupted activity must not prevent the React gate from running. */ }
}
