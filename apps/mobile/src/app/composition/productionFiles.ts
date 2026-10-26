import { File, Paths } from "expo-file-system";
import { PRODUCTION_DATABASE } from "./productionDatabase.ts";

/** Expo SQLite uses filesDir.canonicalPath/SQLite; filesystem uses filesDir's URI.
 * Android can expose that same directory through /data/data and /data/user/0.
 * Use the filesystem spelling for its private-path checks and restore renames.
 * This matches the pinned Expo SQLite Android default, without opening a new DB.
 */
export const productionLiveFile = () => new File(Paths.document, "SQLite", PRODUCTION_DATABASE);
