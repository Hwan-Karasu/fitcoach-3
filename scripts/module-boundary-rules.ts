const sourcePrefix = "apps/mobile/src/";
const forbiddenDomainPackages = /^(?:react(?:-native)?(?:\/|$)|@react-navigation\/|expo(?:-|\/|$)|@expo\/|node:)/u;
const sqlitePackages = /^(?:expo-sqlite(?:\/|$)|react-native-sqlite-storage(?:\/|$)|better-sqlite3(?:\/|$))/u;

export type BoundaryCode =
  | "UNKNOWN_SOURCE_ALIAS"
  | "OUTSIDE_MOBILE_SOURCE"
  | "FEATURE_TO_HIGHER_LAYER"
  | "SHARED_TO_HIGHER_LAYER"
  | "CROSS_FEATURE_INTERNAL"
  | "DOMAIN_TO_FEATURE"
  | "DOMAIN_TO_IMPURE_LAYER"
  | "DOMAIN_TO_RUNTIME_PACKAGE"
  | "DATA_TO_OTHER_FEATURE"
  | "UI_TO_DATABASE"
  | "CONSUMER_TO_FEATURE_INTERNAL"
  | "APPLICATION_TO_DATA"
  | "APPLICATION_TO_PRESENTATION"
  | "DATA_TO_APPLICATION"
  | "DATA_TO_PRESENTATION"
  | "PUBLIC_TO_DATABASE";

export function validateModuleImport(
  from: string,
  target: string | null,
  specifier: string,
): readonly BoundaryCode[] {
  const violations = new Set<BoundaryCode>();
  const fromPath = normalize(from);
  const targetPath = target === null ? null : normalize(target);
  const fromOwner = featureOwner(fromPath);
  const targetOwner = targetPath === null ? null : featureOwner(targetPath);
  const domain = isWithin(fromPath, "domain");
  const data = isWithin(fromPath, "data");
  const application = isWithin(fromPath, "application");
  const featurePublic = fromOwner !== null && fromPath === `${sourcePrefix}${fromOwner}/public.ts`;
  const higherConsumer = fromPath.startsWith(`${sourcePrefix}app/`) ||
    fromPath.startsWith(`${sourcePrefix}workflows/`) ||
    fromPath.startsWith(`${sourcePrefix}read-models/`);
  const compositionRoot = fromPath.startsWith(`${sourcePrefix}app/composition/`);
  const ui = fromPath.endsWith(".tsx") || isWithin(fromPath, "presentation") ||
    isWithin(fromPath, "screens") || fromPath.startsWith(`${sourcePrefix}shared/ui/`) ||
    fromPath.startsWith(`${sourcePrefix}app/navigation/`);

  if (specifier.startsWith("@/") || specifier.startsWith("src/")) {
    violations.add("UNKNOWN_SOURCE_ALIAS");
  }
  if (targetPath !== null && !targetPath.startsWith(sourcePrefix) &&
    !(fromPath === "apps/mobile/index.ts" && targetPath === "apps/mobile/App.tsx")) {
    violations.add("OUTSIDE_MOBILE_SOURCE");
  }
  if (domain && forbiddenDomainPackages.test(specifier)) {
    violations.add("DOMAIN_TO_RUNTIME_PACKAGE");
  }
  if (ui && sqlitePackages.test(specifier)) {
    violations.add("UI_TO_DATABASE");
  }
  if (featurePublic && sqlitePackages.test(specifier)) {
    violations.add("PUBLIC_TO_DATABASE");
  }
  if (targetPath === null || !targetPath.startsWith(sourcePrefix)) {
    return [...violations];
  }

  if (fromOwner !== null && (
    targetPath.startsWith(`${sourcePrefix}app/`) ||
    targetPath.startsWith(`${sourcePrefix}workflows/`) ||
    targetPath.startsWith(`${sourcePrefix}read-models/`)
  )) {
    violations.add("FEATURE_TO_HIGHER_LAYER");
  }
  if (fromPath.startsWith(`${sourcePrefix}shared/`) && (
    targetOwner !== null || targetPath.startsWith(`${sourcePrefix}app/`) ||
    targetPath.startsWith(`${sourcePrefix}workflows/`) ||
    targetPath.startsWith(`${sourcePrefix}read-models/`)
  )) {
    violations.add("SHARED_TO_HIGHER_LAYER");
  }
  if (fromOwner !== null && targetOwner !== null && fromOwner !== targetOwner) {
    if (domain) violations.add("DOMAIN_TO_FEATURE");
    if (data) violations.add("DATA_TO_OTHER_FEATURE");
    if (targetPath !== `${sourcePrefix}${targetOwner}/public.ts`) {
      violations.add("CROSS_FEATURE_INTERNAL");
    }
  }
  if (higherConsumer && targetOwner !== null && targetPath !== `${sourcePrefix}${targetOwner}/public.ts`
    && !(compositionRoot && isWithin(targetPath, "data"))) {
    violations.add("CONSUMER_TO_FEATURE_INTERNAL");
  }
  if (application && fromOwner !== null && targetOwner === fromOwner) {
    if (isWithin(targetPath, "data")) violations.add("APPLICATION_TO_DATA");
    if (isWithin(targetPath, "presentation") || isWithin(targetPath, "screens")) {
      violations.add("APPLICATION_TO_PRESENTATION");
    }
  }
  if (data && fromOwner !== null && targetOwner === fromOwner) {
    if (isWithin(targetPath, "application")) violations.add("DATA_TO_APPLICATION");
    if (isWithin(targetPath, "presentation") || isWithin(targetPath, "screens")) {
      violations.add("DATA_TO_PRESENTATION");
    }
  }
  if (featurePublic && (
    (targetOwner === fromOwner && isWithin(targetPath, "data")) ||
    targetPath.startsWith(`${sourcePrefix}shared/db/`)
  )) {
    violations.add("PUBLIC_TO_DATABASE");
  }
  if (domain && (
    targetPath.startsWith(`${sourcePrefix}app/`) ||
    targetPath.startsWith(`${sourcePrefix}workflows/`) ||
    targetPath.startsWith(`${sourcePrefix}read-models/`) ||
    targetPath.startsWith(`${sourcePrefix}shared/db/`) ||
    targetPath.startsWith(`${sourcePrefix}shared/platform/`) ||
    targetPath.startsWith(`${sourcePrefix}shared/ui/`) ||
    ["application", "data", "presentation", "screens"].some((layer) => isWithin(targetPath, layer))
  )) {
    violations.add("DOMAIN_TO_IMPURE_LAYER");
  }
  if (ui && (
    targetPath.startsWith(`${sourcePrefix}shared/db/`) || isWithin(targetPath, "data")
  )) {
    violations.add("UI_TO_DATABASE");
  }
  return [...violations];
}

function featureOwner(file: string): string | null {
  if (!file.startsWith(`${sourcePrefix}features/`)) return null;
  const parts = file.slice(`${sourcePrefix}features/`.length).split("/");
  const first = parts[0];
  if (!first) return null;
  if (first === "training" && ["plans", "execution", "analytics", "archive"].includes(parts[1] ?? "")) {
    return `features/training/${parts[1]}`;
  }
  return `features/${first}`;
}

function isWithin(file: string, segment: string): boolean {
  return file.split("/").includes(segment);
}

function normalize(file: string): string {
  return file.replaceAll("\\", "/");
}
