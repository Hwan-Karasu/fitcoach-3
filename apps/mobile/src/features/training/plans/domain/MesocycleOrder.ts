/** A reorder may only permute the complete current set, never remove or duplicate cycles. */
export function isCompleteMesocycleOrder(currentIds: readonly string[], nextIds: readonly string[]): boolean {
  const expected = new Set(currentIds);
  return nextIds.length === currentIds.length && new Set(nextIds).size === nextIds.length
    && nextIds.every((id) => expected.has(id));
}
