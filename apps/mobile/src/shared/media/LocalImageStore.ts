import { Directory, File, Paths } from "expo-file-system";

const FOLDER = "local-images";

/** Copy a user-selected local image out of picker cache. No camera/network request. */
export function storeLocalImage(uri: string): string {
  const folder = new Directory(Paths.document, FOLDER);
  folder.create({ idempotent: true, intermediates: true });
  const extension = /\.(png|jpg|jpeg|webp|heic)$/iu.exec(uri)?.[1] ?? "jpg";
  const target = new File(folder, `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  new File(uri).copy(target);
  return target.uri;
}

/** Удаляет только собственную копию из каталога приложения; чужой путь и сбой удаления молча игнорируются (файл не факт). */
export function deleteLocalImage(uri: string): void {
  try {
    const folder = new Directory(Paths.document, FOLDER);
    if (!uri.startsWith(`${folder.uri.replace(/\/$/u, "")}/`)) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    /* Осиротевший файл безвреден: повторим при следующей замене. */
  }
}
