import { SnapshotError } from "../domain/SnapshotManifest.ts";
export type ImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/heic";
export const IMAGE_MIMES: readonly ImageMime[] = ["image/png", "image/jpeg", "image/webp", "image/heic"];
export const IMAGE_EXTENSION: Readonly<Record<ImageMime, string>> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/heic": "heic" };
export interface RecipePhotoReference { readonly id: string; readonly originalJson: string; readonly sourceUri: string }
export interface RestoredRecipePhoto extends RecipePhotoReference { readonly restoredUri: string }
export function isLocalImageUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 2000) return false;
  try { const url = new URL(uri); return url.protocol === "file:" && url.host === "" && url.search === "" && url.hash === ""; }
  catch { return false; }
}
export function imageMime(bytes: Uint8Array): ImageMime {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp" && ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(ascii(8, 12))) return "image/heic";
  throw new SnapshotError("SNAPSHOT_INCOMPLETE_MEDIA");
}
/** Relocation may change exactly photoUri, never revision, dates or other JSON data. */
export function originalPhotoJsonForParity(value: unknown, photo: RestoredRecipePhoto): string {
  if (typeof value !== "string") throw new SnapshotError("SNAPSHOT_INVALID");
  const before = JSON.parse(photo.originalJson) as Record<string, unknown>;
  const after = JSON.parse(value) as Record<string, unknown>;
  if (JSON.stringify(after) !== JSON.stringify({ ...before, photoUri: photo.restoredUri })) throw new SnapshotError("SNAPSHOT_INVALID");
  return photo.originalJson;
}
