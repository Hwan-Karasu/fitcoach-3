// Compatibility imports for host fixtures. The format and algorithms now live in mobile.
export { MEDIA_CHUNK_BYTES, MEDIA_CHUNKS, MEDIA_TABLE, mediaDdl } from "../../apps/mobile/src/features/backup/data/SnapshotCatalog.ts";
export { originalPhotoJsonForParity } from "../../apps/mobile/src/features/backup/data/SnapshotPhotoRules.ts";
export type { RestoredRecipePhoto, RecipePhotoReference } from "../../apps/mobile/src/features/backup/data/SnapshotPhotoRules.ts";
export type { SnapshotMediaProgress } from "../../apps/mobile/src/features/backup/data/SnapshotMediaPort.ts";
export type { SnapshotMediaOptions } from "./NodeSnapshotMedia.ts";
