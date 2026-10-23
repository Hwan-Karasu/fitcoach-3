/** Android expo-sqlite exposes a native absolute directory path; Expo filesystem expects
 * a URI. Escape native path segments once, preserving an already encoded file URI. */
export function sqliteDirectoryUri(value: string): string {
  try {
    if (typeof value !== "string") throw new Error();
    const uri = value.startsWith("file:///");
    const path = uri ? decodeURIComponent(value.slice("file://".length)) : value;
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || [...path].some((char) => char.charCodeAt(0) < 32) ||
      path.split("/").some((segment) => segment === "." || segment === "..") || (uri && /[?#\s]/u.test(value))) throw new Error();
    return uri ? value : `file://${path.split("/").map(encodeURIComponent).join("/")}`;
  } catch { throw new Error("SQLITE_DIRECTORY_INVALID"); }
}
