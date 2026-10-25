/** Bridge-only source contracts; no database handles, file routing or cutover API. */
export type { LegacyImportSourceSnapshots } from "./domain/LegacySourceSnapshots.ts";
export { InspectionCopyError, parseInspectionReceipt } from "./domain/InspectionCopy.ts";
export type { LegacyInspectionReceipt } from "./domain/InspectionCopy.ts";
