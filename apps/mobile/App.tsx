import { useState } from "react";
import FoundationScreen from "./src/app/bootstrap/FoundationScreen";
import { DevBootGate } from "./src/app/bootstrap/DevBootGate.tsx";
import { createDevRuntime } from "./src/app/composition/createDevServices.ts";

function DevEntry() {
  const [runtime] = useState(createDevRuntime);
  return <DevBootGate {...runtime} />;
}

export default function App() {
  return __DEV__ ? <DevEntry /> : <FoundationScreen />;
}
