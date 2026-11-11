import { useEffect, useState } from "react";
import { Keyboard } from "react-native";
import { KeyboardEvents } from "react-native-keyboard-controller";

/**
 * Показана ли клавиатура. Прячем/показываем в НАЧАЛЕ анимации (`keyboardWillShow`/`keyboardWillHide` из keyboard-controller работают и на Android),
 * `keyboardDid*` — запасной путь на случай, если событие провайдера не пришло. Подписки отдаются в cleanup.
 */
export function useKeyboardVisible(): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const subscriptions = [
      KeyboardEvents.addListener("keyboardWillShow", () => setVisible(true)),
      KeyboardEvents.addListener("keyboardWillHide", () => setVisible(false)),
      Keyboard.addListener("keyboardDidShow", () => setVisible(true)),
      Keyboard.addListener("keyboardDidHide", () => setVisible(false)),
    ];
    return () => { for (const subscription of subscriptions) subscription.remove(); };
  }, []);
  return visible;
}
