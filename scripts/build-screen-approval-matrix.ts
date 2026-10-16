import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface AtlasEntry {
  order: number;
  id: string;
  name: string;
  refs: string;
  status: string;
}

interface RegistryEntry {
  id: string;
  group: string;
  name: string;
  ref: string;
  actions: string;
  states: string;
  notes: string;
  status: string;
}

interface ScreenEntry {
  order: number;
  id: string;
  group: string;
  name: string;
  productRefs: string;
  atlasSourceStatus: string;
  registrySourceStatus: string;
  screenStatus: "PROPOSED";
  approvalOwner: "PRODUCT_OWNER";
  approvalEvidence: "MISSING";
  goldens: {
    darkAndroid: "MISSING";
    lightAndroid: "MISSING";
    accentMatrix9x3: "MISSING";
  };
  reviewInputs: {
    actions: string;
    states: string;
    notes: string;
  };
  requiredChecks: {
    widthsDp: number[];
    fontScale: number[];
    longRussianText: "REQUIRED";
    localizedDecimalComma: "REQUIRED";
    loadingEmptyErrorDirty: "REQUIRED_WHERE_APPLICABLE";
    keyboardFocusBackSafeAreaTalkBack: "REQUIRED";
    touchTargetMinDp: 48;
  };
  productScopeReview: "REQUIRED" | "NOT_FLAGGED_BY_ATLAS";
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(
  projectRoot,
  "..",
  "FitCoach_3_DOCUMENTS_SYNCED_2026-10-14",
);
const atlasPath = path.join(
  sourceRoot,
  "05-UI-UX",
  "SCREEN_ATLAS_SPECIFICATIONS_SYNCED.md",
);
const registryPath = path.join(sourceRoot, "05-UI-UX", "screen-registry.json");
const outputDirectory = path.join(projectRoot, "docs", "ui");

const atlas = await readFile(atlasPath, "utf8");
const parsedRegistry: unknown = JSON.parse(
  stripBom(await readFile(registryPath, "utf8")),
);
if (!isRegistry(parsedRegistry)) {
  fail("screen registry contains an invalid entry");
}
const registry = parsedRegistry;
const atlasEntries = parseAtlasTable(atlas);

if (atlasEntries.length !== 43) {
  fail(`expected 43 Atlas entries, found ${atlasEntries.length}`);
}
if (!Array.isArray(registry) || registry.length !== 48) {
  fail(`expected 48 registry entries, found ${String(registry?.length)}`);
}
for (const [index, entry] of atlasEntries.entries()) {
  if (entry.order !== index + 1) {
    fail(`Atlas order is not consecutive at screen ${entry.id}`);
  }
}
if (new Set(atlasEntries.map((entry) => entry.id)).size !== atlasEntries.length) {
  fail("Atlas has duplicate screen IDs");
}
if (new Set(registry.map((entry) => entry.id)).size !== registry.length) {
  fail("screen registry has duplicate IDs");
}

const registryById = new Map(registry.map((entry) => [entry.id, entry]));
const screenEntries: ScreenEntry[] = atlasEntries.map((atlasEntry) => {
  const registered = registryById.get(atlasEntry.id);
  if (!registered) fail(`Atlas screen missing from registry: ${atlasEntry.id}`);
  if (registered.name !== atlasEntry.name) {
    fail(
      `name mismatch for ${atlasEntry.id}: Atlas=${atlasEntry.name}, registry=${registered.name}`,
    );
  }
  return {
    order: atlasEntry.order,
    id: atlasEntry.id,
    group: registered.group,
    name: atlasEntry.name,
    productRefs: atlasEntry.refs,
    atlasSourceStatus: atlasEntry.status,
    registrySourceStatus: registered.status,
    screenStatus: "PROPOSED",
    approvalOwner: "PRODUCT_OWNER",
    approvalEvidence: "MISSING",
    goldens: {
      darkAndroid: "MISSING",
      lightAndroid: "MISSING",
      accentMatrix9x3: "MISSING",
    },
    reviewInputs: {
      actions: registered.actions,
      states: registered.states,
      notes: registered.notes,
    },
    requiredChecks: {
      widthsDp: [320, 360, 390, 412],
      fontScale: [1, 1.3, 1.6],
      longRussianText: "REQUIRED",
      localizedDecimalComma: "REQUIRED",
      loadingEmptyErrorDirty: "REQUIRED_WHERE_APPLICABLE",
      keyboardFocusBackSafeAreaTalkBack: "REQUIRED",
      touchTargetMinDp: 48,
    },
    productScopeReview:
      atlasEntry.id === "import" ? "REQUIRED" : "NOT_FLAGGED_BY_ATLAS",
  };
});

const atlasIds = new Set(atlasEntries.map((entry) => entry.id));
const supplementalRegistryEntries = registry
  .filter((entry) => !atlasIds.has(entry.id))
  .map((entry) => ({
    id: entry.id,
    group: entry.group,
    name: entry.name,
    productRefs: entry.ref,
    registrySourceStatus: entry.status,
    screenStatus: "REGISTRY_ONLY_NOT_ATLAS_V0_7",
  }));

if (supplementalRegistryEntries.length !== 5) {
  fail(
    `expected 5 supplemental registry entries, found ${supplementalRegistryEntries.length}`,
  );
}

const matrix = {
  schemaVersion: "1.0",
  generated: "2026-10-15",
  task: "S03",
  source: {
    atlas: "05-UI-UX/SCREEN_ATLAS_SPECIFICATIONS_SYNCED.md",
    registry: "05-UI-UX/screen-registry.json",
  },
  status: "MAP_COMPLETE_SCREEN_APPROVALS_PENDING",
  summary: {
    atlasEntries: screenEntries.length,
    approvedScreens: 0,
    proposedScreens: screenEntries.length,
    missingDarkGoldens: screenEntries.length,
    missingLightGoldens: screenEntries.length,
    supplementalRegistryEntries: supplementalRegistryEntries.length,
  },
  screens: screenEntries,
  supplementalRegistryEntries,
};

await mkdir(outputDirectory, { recursive: true });
await writeFile(
  path.join(outputDirectory, "SCREEN_APPROVAL_MATRIX.json"),
  `${JSON.stringify(matrix, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(outputDirectory, "SCREEN_APPROVAL_MATRIX.csv"),
  toCsv(screenEntries),
  "utf8",
);

console.log(
  `UI approval matrix OK: ${screenEntries.length} Atlas screens, ${supplementalRegistryEntries.length} supplemental registry entries, 0 approved screens`,
);

function parseAtlasTable(markdown: string): AtlasEntry[] {
  const rowPattern =
    /^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\(#([^)]+)\)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/gm;
  return [...markdown.matchAll(rowPattern)].map((match) => {
    const [, order, name, id, refs, status] = match;
    if (!order || !name || !id || !refs || !status) {
      fail("Atlas row has missing columns");
    }
    return {
      order: Number(order),
      name: name.trim(),
      id: id.trim(),
      refs: refs.trim(),
      status: status.trim(),
    };
  });
}

function toCsv(entries: ScreenEntry[]): string {
  const headings = [
    "order",
    "id",
    "group",
    "name",
    "product_refs",
    "screen_status",
    "approval_owner",
    "approval_evidence",
    "dark_android_golden",
    "light_android_golden",
    "accent_matrix_9x3",
    "actions",
    "states",
    "long_text",
    "font_scale",
    "product_scope_review",
  ];
  const rows = entries.map((entry) => [
    entry.order,
    entry.id,
    entry.group,
    entry.name,
    entry.productRefs,
    entry.screenStatus,
    entry.approvalOwner,
    entry.approvalEvidence,
    entry.goldens.darkAndroid,
    entry.goldens.lightAndroid,
    entry.goldens.accentMatrix9x3,
    entry.reviewInputs.actions,
    entry.reviewInputs.states,
    entry.requiredChecks.longRussianText,
    entry.requiredChecks.fontScale.join("/"),
    entry.productScopeReview,
  ]);
  return `${[headings, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
}

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function stripBom(value: string): string {
  return value.replace(/^\uFEFF/, "");
}

function isRegistry(value: unknown): value is RegistryEntry[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry: unknown) =>
      isRecord(entry) &&
      ["id", "group", "name", "ref", "actions", "states", "notes", "status"].every(
        (key) => typeof entry[key] === "string",
      ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  console.error(`UI approval matrix FAILED: ${message}`);
  process.exit(1);
}

