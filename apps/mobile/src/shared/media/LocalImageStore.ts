import { Directory, File, Paths } from "expo-file-system";

/** Copy a user-selected local image out of picker cache. No camera/network request. */
export function storeLocalImage(uri: string): string {
  const folder = new Directory(Paths.document, "local-images");
  folder.create({ idempotent: true, intermediates: true });
  const extension = /\.(png|jpg|jpeg|webp|heic)$/iu.exec(uri)?.[1] ?? "jpg";
  const target = new File(folder, `${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`);
  new File(uri).copy(target);
  return target.uri;
}
