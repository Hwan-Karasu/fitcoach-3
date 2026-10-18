import type { ReactNode } from "react";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { usePrototypeTheme } from "../theme/PrototypeThemeProvider.tsx";

/** Общий контейнер конструктора: список сжимается под клавиатуру, действия остаются доступными. */
export function TrainingEditorLayout({ children }: Readonly<{ children: ReactNode }>) {
  const { palette } = usePrototypeTheme();
  return <KeyboardAvoidingView automaticOffset behavior="padding" style={{ flex: 1, backgroundColor: palette.tokens.canvas }}>
    {children}
  </KeyboardAvoidingView>;
}
