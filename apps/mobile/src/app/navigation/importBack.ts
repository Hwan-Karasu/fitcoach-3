import type { CatalogBackHandle } from "../../features/exercises/public.ts";
export type ImportPage = "review" | "catalog" | "create" | null;
export function previousImportPage(page: ImportPage, catalog: CatalogBackHandle | null): ImportPage {
  if (page === "catalog" && catalog?.handleBack()) return "catalog";
  return page === "create" ? "catalog" : page === "catalog" ? "review" : null;
}
