import { useImperativeHandle, type Ref } from "react";

export interface CatalogBackHandle { handleBack(): boolean }
/** RN Modal sends Android Back to its owner; let the embedded catalogue consume overlays first. */
export function useCatalogBack(ref: Ref<CatalogBackHandle> | undefined, open: boolean, close: () => void): void {
  useImperativeHandle(ref, () => ({ handleBack: () => { if (!open) return false; close(); return true; } }), [open, close]);
}
