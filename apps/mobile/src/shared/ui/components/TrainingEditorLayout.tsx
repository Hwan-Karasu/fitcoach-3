import type { ReactNode } from "react";
import { KeyboardInsetView } from "./KeyboardInsetView.tsx";
import { View } from "react-native";
import { useBottomPanelInFlow } from "./BottomPanel.tsx";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/** Общий контейнер конструктора: список сжимается под клавиатуру, действия остаются доступными. */
export function TrainingEditorLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  const inFlow = useBottomPanelInFlow();
  if (inFlow) return <View style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>{children}</View>;
  return <KeyboardInsetView style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
    {children}
  </KeyboardInsetView>;
}
