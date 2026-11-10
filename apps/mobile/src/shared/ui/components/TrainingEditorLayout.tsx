import type { ReactNode } from "react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { View } from "react-native";
import { useBottomPanelInFlow } from "./BottomPanel.tsx";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/** Общий контейнер конструктора: список сжимается под клавиатуру, действия остаются доступными. */
export function TrainingEditorLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const inFlow = useBottomPanelInFlow();
  if (inFlow) return <View style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>{children}</View>;
  return <KeyboardAvoidingView automaticOffset behavior="padding" style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
    {children}
  </KeyboardAvoidingView>;
}
