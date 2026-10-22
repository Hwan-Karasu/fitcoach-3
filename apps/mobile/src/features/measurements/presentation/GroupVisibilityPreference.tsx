import { createContext, useContext } from "react";

/** Где карточка «Замеры» хранит выбор видимых групп. Без провайдера выбор живёт только до закрытия экрана. */
export interface GroupVisibilityPreference {
  readonly load: () => Promise<readonly string[] | null>;
  readonly save: (ids: readonly string[]) => Promise<void>;
}

const Context = createContext<GroupVisibilityPreference | null>(null);

export const GroupVisibilityPreferenceProvider = Context.Provider;

export function useGroupVisibilityPreference(): GroupVisibilityPreference | null {
  return useContext(Context);
}
