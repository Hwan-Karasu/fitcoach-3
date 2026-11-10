import "./src/app/bootstrap/nativeSplash.ts";
import { registerRootComponent } from "expo";
import App from "./App";
import { installWorkoutNavigationProbe } from "./src/app/diagnostics/installWorkoutNavigationProbe.ts";

installWorkoutNavigationProbe();
registerRootComponent(App);
