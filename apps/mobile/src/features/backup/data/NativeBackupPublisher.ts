import { requireOptionalNativeModule } from "expo-modules-core";
import { BackupStorageError, parsePublishedBackup, publicationTreeUri, type BackupDestination, type BackupPublisherPort,
  type PublishedBackup, type VerifiedBackupFile } from "../domain/BackupPublication.ts";

interface NativeStorage {
  supportsDownloads(): boolean;
  publish(sourceUri: string, backupId: string, createdAt: string, sha256: string, bytes: number, treeUri: string | null): Promise<unknown>;
}
/** Missing in Expo Go: absence is a capability state, never an import-time application crash. */
export function nativeBackupPublisher(): BackupPublisherPort {
  const native = requireOptionalNativeModule<NativeStorage>("AthleteBackupStorage");
  const supportsDownloads = (() => { try { return native?.supportsDownloads() === true; } catch { return false; } })();
  return {
    available: native !== null,
    supportsDownloads,
    async publish(source: VerifiedBackupFile, destination: BackupDestination): Promise<PublishedBackup> {
      if (native === null) throw new BackupStorageError("BACKUP_STORAGE_UNAVAILABLE");
      try {
        const result = await native.publish(source.sourceUri, source.backupId, source.createdAt, source.sha256,
          source.bytes, publicationTreeUri(destination));
        return parsePublishedBackup(result, source);
      } catch (error) {
        if (error instanceof BackupStorageError) throw error;
        throw new BackupStorageError("BACKUP_DESTINATION_UNAVAILABLE");
      }
    },
  };
}
