import { createContext, useContext, useLayoutEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useIsFocused } from "@react-navigation/native";
import type { PaletteTokens } from "../theme/resolver.ts";
import { createSlotStore } from "./slotStore.ts";

export interface BottomPanelContent {
  readonly navigation: ReactNode;
  readonly participants: ReactNode;
  readonly tokens: PaletteTokens;
}

const Context = createContext<ReturnType<typeof createSlotStore<BottomPanelContent>> | null>(null);
const InFlow = createContext(false);

/** Один узел панели для всех навигаторов; скрытые экраны не могут заменить активные кнопки. */
export function BottomPanelProvider({ children }: Readonly<{ children: ReactNode }>) {
  const store = useMemo(() => createSlotStore<BottomPanelContent>(), []);
  return <Context.Provider value={store}><InFlow.Provider value>{children}</InFlow.Provider></Context.Provider>;
}

export function useBottomPanelInFlow() { return useContext(InFlow); }

export function usePublishBottomPanel(owner: string, content: BottomPanelContent) {
  const store = useContext(Context);
  const focused = useIsFocused();
  // Публикация зависит от полей, а не от нового объекта каждого рендера: без смены содержимого подписчики панели не перерисовываются.
  const { navigation, participants, tokens } = content;
  const stable = useMemo<BottomPanelContent>(() => ({ navigation, participants, tokens }), [navigation, participants, tokens]);
  useLayoutEffect(() => { if (focused) store?.set(owner, stable); }, [store, owner, focused, stable]);
  // Обновление содержимого не снимает регистрацию между двумя кадрами.
  useLayoutEffect(() => {
    if (!focused) return undefined;
    return () => store?.remove(owner);
  }, [store, owner, focused]);
}

const emptyStore = createSlotStore<BottomPanelContent>();
export function useBottomPanelContent(): BottomPanelContent | null {
  const store = useContext(Context) ?? emptyStore;
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return [...snapshot.values()].at(-1) ?? null;
}
