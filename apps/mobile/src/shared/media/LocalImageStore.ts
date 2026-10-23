import { Directory, File, Paths } from "expo-file-system";
import { uuid } from "expo-modules-core";
import { isLocalImageStoreUri } from "./LocalImagePath.ts";

const FOLDER = "local-images";

/** Copy a user-selected local image out of picker cache. No camera/network request. */
export async function storeLocalImage(uri: string): Promise<string> {
  const folder = new Directory(Paths.document, FOLDER);
  folder.create({ idempotent: true, intermediates: true });
  const extension = /\.(png|jpg|jpeg|webp|heic)$/iu.exec(uri)?.[1] ?? "jpg";
  const target = new File(folder, `${uuid.v4()}.${extension}`);
  target.create(); // Reserve a new private file; failure never deletes an existing target.
  try {
    const source = new File(uri);
    const expectedSize = source.size;
    await source.copy(target, { overwrite: true }); // Only the owned placeholder is replaced.
    if (!target.exists || target.size <= 0 || (expectedSize > 0 && target.size !== expectedSize)) throw new Error("LOCAL_IMAGE_STORE_FAILED");
    return target.uri;
  } catch {
    try { if (target.exists) target.delete(); } catch { /* Unreferenced private partial; never publish its URI. */ }
    throw new Error("LOCAL_IMAGE_STORE_FAILED");
  }
}

/** Удаляет только собственную копию из каталога приложения; чужой путь и сбой удаления молча игнорируются (файл не факт). */
export function deleteLocalImage(uri: string): void {
  try {
    const folder = new Directory(Paths.document, FOLDER);
    if (!isLocalImageStoreUri(uri, folder.uri)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* Осиротевший файл безвреден: повторим при следующей замене. */
  }
}
