import { useCallback, useState } from "react";

/** Reconcile a new slot before commit, keeping focused/pending edits of the same slot intact. */
export function useInputDraft(identity: string, saved: string, protectedDraft: boolean) {
  const [draft, setDraft] = useState({ identity, saved, text: saved, invalid: false });
  const reset = draft.identity !== identity || (!protectedDraft && draft.saved !== saved);
  const shown = reset ? { identity, saved, text: saved, invalid: false } : draft;
  if (reset) setDraft(shown);
  const change = useCallback((text: string, invalid = false) => setDraft((old) => ({ ...old, text, invalid })), []);
  return { text: shown.text, invalid: shown.invalid, change };
}
