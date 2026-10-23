import { Directory, File } from "expo-file-system";
import { moveAsync } from "expo-file-system/legacy";
import { uuid } from "expo-modules-core";
import { AutomaticBackupError, parseAutomaticCatalog, parseAutomaticFailure, type AutomaticBackupStore } from "../domain/AutomaticBackup.ts";
import { assertSnapshotPrivateUri } from "./ExpoSnapshotMedia.ts";

/** Installation-local retention/permission metadata, outside every restored SQLite snapshot. */
export function expoAutomaticBackupStore(root: Directory): AutomaticBackupStore & { protectedJobIds(): Promise<readonly string[]> } {
  assertSnapshotPrivateUri(root.uri); const file = new File(root, "automatic.json");
  return {
    async readFailure() {
      const status = new File(root, "automatic-status.json"); if (!status.exists) return null;
      try { if (status.size > 4096) throw new Error(); return parseAutomaticFailure(JSON.parse(await status.text()) as unknown); }
      catch { throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE"); }
    },
    async writeFailure(failure) {
      const checked = parseAutomaticFailure(failure); const next = new File(root, `automatic-status-${uuid.v4()}.next`); let created = false;
      try {
        root.create({ idempotent: true, intermediates: true }); next.create(); created = true; next.write(JSON.stringify(checked));
        if (JSON.stringify(parseAutomaticFailure(JSON.parse(await next.text()) as unknown)) !== JSON.stringify(checked)) throw new Error();
        await moveAsync({ from: next.uri, to: new File(root, "automatic-status.json").uri });
      } catch { throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE");
      } finally { if (created && next.exists) next.delete(); }
    },
    async protectedJobIds() {
      const ids: string[] = []; const current = await this.read(); if (current?.pending) ids.push(current.pending.backupId);
      if (!root.exists) return ids;
      for (const entry of root.list()) if (entry instanceof File && /^automatic-history-[a-f0-9-]{36}\.json$/u.test(entry.name)) {
        if (entry.size > 131072) throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE");
        const catalog = parseAutomaticCatalog(JSON.parse(await entry.text()) as unknown);
        if (catalog.pending) ids.push(catalog.pending.backupId);
      }
      return ids;
    },
    async archive(catalog) {
      const checked = parseAutomaticCatalog(catalog); root.create({ idempotent: true, intermediates: true });
      const archive = new File(root, `automatic-history-${uuid.v4()}.json`);
      const next = new File(`${archive.uri}.next`); let created = false;
      try {
        next.create(); created = true; next.write(JSON.stringify(checked));
        if (JSON.stringify(parseAutomaticCatalog(JSON.parse(await next.text()) as unknown)) !== JSON.stringify(checked)) throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE");
        await moveAsync({ from: next.uri, to: archive.uri });
      } finally { if (created && next.exists) next.delete(); }
    },
    async read() {
      try {
        if (!file.exists) return null;
        if (file.size > 131072) throw new Error();
        return parseAutomaticCatalog(JSON.parse(await file.text()) as unknown);
      } catch { throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE"); }
    },
    async write(catalog) {
      const checked = parseAutomaticCatalog(catalog); const next = new File(root, `automatic-${uuid.v4()}.next`);
      let created = false;
      try {
        root.create({ idempotent: true, intermediates: true }); next.create(); created = true;
        next.write(JSON.stringify(checked));
        if (JSON.stringify(parseAutomaticCatalog(JSON.parse(await next.text()) as unknown)) !== JSON.stringify(checked)) throw new Error();
        await moveAsync({ from: next.uri, to: file.uri });
      } catch { throw new AutomaticBackupError("AUTO_STATE_UNAVAILABLE"); }
      finally { if (created && next.exists) next.delete(); }
    },
  };
}
