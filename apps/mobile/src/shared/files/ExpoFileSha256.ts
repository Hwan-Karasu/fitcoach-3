import { File, FileMode } from "expo-file-system";
import { requireOptionalNativeModule } from "expo-modules-core";
import { localFileSha256, LocalFileHashError } from "./LocalFileSha256.ts";

interface NativeFileHash { fileSha256?(uri: string): Promise<{ sha256: string; bytes: number }> }

/**
 * Caller must keep the private file immutable for the duration of this read. В сборке APK хеш считает нативный модуль в фоне
 * (AUTO-BACKUP-1: JS-поток не занят); без него (Expo Go) — JS порциями по времени. Результат один и тот же.
 */
export async function expoFileSha256(file: File): Promise<{ readonly sha256: string; readonly bytes: number }> {
  const native = nativeHash();
  if (native === null) return localFileSha256({ openReader: () => file.open(FileMode.ReadOnly) });
  try {
    const result = await native(file.uri);
    if (!/^[a-f0-9]{64}$/u.test(result.sha256) || !Number.isSafeInteger(result.bytes) || result.bytes < 0) throw new Error();
    return { sha256: result.sha256, bytes: result.bytes };
  } catch { throw new LocalFileHashError(); }
}

/** Без кэша: поиск модуля дёшев, а кэш мешал бы подмене в тестах. */
function nativeHash(): ((uri: string) => Promise<{ sha256: string; bytes: number }>) | null {
  try {
    const module = requireOptionalNativeModule<NativeFileHash>("AthleteBackupStorage");
    return typeof module?.fileSha256 === "function" ? (uri) => module.fileSha256!(uri) : null;
  } catch { return null; }
}
