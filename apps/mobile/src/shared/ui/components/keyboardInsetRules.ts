/**
 * Нижний отступ контейнера под клавиатуру (KBD-GAP-1). Формула та же, что у `KeyboardAvoidingView` из keyboard-controller
 * (`behavior="padding"`): часть контейнера, перекрытая клавиатурой, умноженная на прогресс её анимации. `forcedClosed` — клавиатуры
 * точно нет, что бы ни думала библиотека: отступ ноль.
 */
export function keyboardInset(frameBottom: number, screenHeight: number, keyboardHeight: number, progress: number, forcedClosed: boolean): number {
  "worklet";
  if (forcedClosed) return 0;
  return Math.max(frameBottom - (screenHeight - keyboardHeight), 0) * progress;
}

export type KeyboardInsetEvent = Readonly<{ kind: "HIDDEN" }> | Readonly<{ kind: "SHOWN" }> | Readonly<{ kind: "KEYBOARD"; height: number }>;

/**
 * Библиотека узнаёт о закрытии клавиатуры только из анимации окна. Клавиатура, исчезнувшая без анимации (экран заблокирован или
 * приложение свёрнуто с открытой клавиатурой, закрыто окно с полем ввода), оставляет её состояние «открыта» — и под нижней панелью
 * оставалась пустая полоса высотой с клавиатуру. Сигнал «скрыта» (`HIDDEN`) приходит от независимого источника — событий `Keyboard`
 * React Native. Любое событие библиотеки с ненулевой высотой (начало показа, кадр, конец) его снимает: запоздавший сигнал не оставит
 * поле ввода под открытой клавиатурой. Его же снимает сигнал «показана» (`SHOWN`) того же независимого источника: клавиатура может и
 * вернуться без анимации (разблокировка экрана), и тогда отступ берётся из высоты прошлого показа.
 */
export function forcedClosedAfter(current: boolean, event: KeyboardInsetEvent): boolean {
  "worklet";
  if (event.kind === "HIDDEN") return true;
  if (event.kind === "SHOWN") return false;
  return event.height > 0 ? false : current;
}
