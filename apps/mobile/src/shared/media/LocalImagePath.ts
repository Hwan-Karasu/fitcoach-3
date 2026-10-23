/** The local image store is flat. Reject traversal (including encoded segments) before
 * constructing a native File, which may normalize away the evidence. */
export function isLocalImageStoreUri(uri: string, folderUri: string): boolean {
  const prefix = `${folderUri.replace(/\/$/u, "")}/`;
  if (!uri.startsWith(prefix)) return false;
  try {
    const name = decodeURIComponent(uri.slice(prefix.length));
    return name.length > 0 && name !== "." && name !== ".." && !name.includes("\0") && !/[/\\?#]/u.test(name);
  } catch { return false; }
}
