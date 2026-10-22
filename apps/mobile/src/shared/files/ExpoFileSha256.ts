import { File, FileMode } from "expo-file-system";
import { localFileSha256 } from "./LocalFileSha256.ts";

/** Caller must keep the private file immutable for the duration of this read. */
export function expoFileSha256(file: File): Promise<{ readonly sha256: string; readonly bytes: number }> {
  return localFileSha256({ openReader: () => file.open(FileMode.ReadOnly) });
}
