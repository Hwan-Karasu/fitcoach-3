import { memo, useEffect, useState } from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { remainingSec, type RestTimer } from "../domain/RestTimerRules.ts";
import { restTimerDiagnostics } from "../../../../shared/diagnostics/RestTimerDiagnostics.ts";

export function restClockText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Секундные обновления только цифр. Окончанием владеет контроллер, а не представление часов. */
export const RestPanelClock = memo(function RestPanelClock({ timer, active, finished, style, disabled }: Readonly<{
  timer: RestTimer; active: boolean; finished: boolean; style: StyleProp<TextStyle>; disabled: boolean;
}>) {
  const [, redraw] = useState(0);
  const { endAt, pausedLeftMs } = timer;
  useEffect(() => {
    restTimerDiagnostics.event("clock-mount");
    return () => restTimerDiagnostics.event("clock-unmount");
  }, []);
  useEffect(() => {
    if (!active || disabled || finished || pausedLeftMs !== null) return undefined;
    let handle: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const left = endAt - Date.now();
      if (left <= 0) return;
      // Align to the next displayed second; delayed callbacks skip missed seconds without drift.
      handle = setTimeout(() => { redraw((value) => value + 1); schedule(); }, Math.max(1, left % 1000 || 1000));
    };
    schedule();
    return () => { clearTimeout(handle); };
  }, [endAt, pausedLeftMs, active, disabled, finished]);
  if (finished) return <Text style={style} numberOfLines={2}>Отдых окончен</Text>;
  // Время всегда в одну строку: если не помещается между кнопками, шрифт слегка уменьшается, а не переносится.
  return <Text style={style} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{restClockText(remainingSec(timer, Date.now()))}</Text>;
});
