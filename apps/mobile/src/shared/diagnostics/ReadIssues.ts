/** A bounded, content-free signal for the UI. Never include stored JSON or personal data. */
const issues = new Set<string>();
const listeners = new Set<() => void>();
export function reportReadIssue(source: string): void {
  if (issues.has(source) || issues.size >= 100) return;
  issues.add(source);
  for (const listener of listeners) { try { listener(); } catch { /* Reading must remain available. */ } }
}
export const readIssueCount = () => issues.size;
export function subscribeReadIssues(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function clearReadIssues(): void {
  issues.clear();
  for (const listener of listeners) { try { listener(); } catch { /* Dismissing the notice must remain safe. */ } }
}
