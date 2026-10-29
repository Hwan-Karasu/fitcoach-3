import { useEffect, useRef, useState } from "react";
import { useIsFocused } from "@react-navigation/native";

/**
 * Счётчик «данные изменились»: растёт на каждое уведомление подписки, пока экран на виду. Изменение, пришедшее на скрытом
 * экране (под ним открыт дневник или другой раздел), запоминается и даёт один пересчёт при возврате. Иначе каждый подход
 * в дневнике заставлял бы все смонтированные экраны заново читать историю и сводки (самая тяжёлая часть — подходы клиента за всё время).
 * `subscribe` возвращает отписку; должна быть стабильной по ссылке.
 */
export function useFocusGatedVersion(subscribe: (listener: () => void) => () => void): number {
  const focused = useIsFocused();
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const stale = useRef(false);
  const [version, setVersion] = useState(0);
  useEffect(() => subscribe(() => {
    if (focusedRef.current) setVersion((value) => value + 1); else stale.current = true;
  }), [subscribe]);
  useEffect(() => {
    if (focused && stale.current) { stale.current = false; setVersion((value) => value + 1); }
  }, [focused]);
  return version;
}
