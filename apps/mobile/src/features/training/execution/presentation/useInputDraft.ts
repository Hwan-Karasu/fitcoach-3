import { useCallback, useState } from "react";
import { reconcileInputDraft } from "../domain/InputDraftRules.ts";

/** Reconcile a new slot before commit, keeping focused/pending edits of the same slot intact. */
export function useInputDraft(identity: string, saved: string, protectedDraft: boolean) {
  const [draft, setDraft] = useState({ identity, saved, text: saved, invalid: false });
  const shown = reconcileInputDraft(draft, identity, saved, protectedDraft);
  if (shown !== draft) setDraft(shown);
  const change = useCallback((text: string, invalid = false) => setDraft((old) => ({ ...old, text, invalid })), []);
  return { text: shown.text, invalid: shown.invalid, change };
}
