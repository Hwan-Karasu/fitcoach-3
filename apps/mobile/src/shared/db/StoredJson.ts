import { reportReadIssue } from "../diagnostics/ReadIssues.ts";

/** Validate persisted data at the boundary; one bad row must not break a whole list. */
export function readStoredJson<T>(json: string, guard: (value: unknown) => value is T, source: string): T | null {
  try {
    const value: unknown = JSON.parse(json);
    if (guard(value)) return value;
  } catch { /* Report a content-free issue below. */ }
  reportReadIssue(source);
  return null;
}
