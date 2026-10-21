import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useIsFocused } from "@react-navigation/native";

const DockContent = createContext<ReactNode>(null);
const RegisterDock = createContext<((content: ReactNode) => void) | null>(null);

/**
 * Дополнительная строка внутри нижней плавающей панели (над кнопками вкладок): экран подставляет в неё свой элемент
 * (переключатель участников программы). Панель и экран — разные ветки дерева; обмен идёт через этот контекст, как у стрелок
 * недель (`WeekNavigation`). Строка входит в раскладку панели: экран над ней уменьшается снизу, а его верх и прокрутка не трогаются.
 */
export function TabBarDockProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [content, setContent] = useState<ReactNode>(null);
  return <RegisterDock.Provider value={setContent}><DockContent.Provider value={content}>{children}</DockContent.Provider></RegisterDock.Provider>;
}

/** Что сейчас показать в строке над вкладками (читает панель). */
export function useTabBarDockContent(): ReactNode { return useContext(DockContent); }

/**
 * Показывает `children` в строке нижней панели, пока экран открыт и компонент смонтирован; при уходе с экрана или размонтировании
 * строка убирается. Регистрация — на каждом рендере (элемент новый), но состояние экрана при этом не меняется: оно только у панели.
 */
export function TabBarDock({ children }: Readonly<{ children: ReactNode }>) {
  const register = useContext(RegisterDock);
  const focused = useIsFocused();
  useEffect(() => {
    if (!focused) return undefined;
    register?.(children);
    return () => register?.(null);
  });
  return null;
}
