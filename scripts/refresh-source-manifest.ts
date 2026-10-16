import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestFile {
  path: string;
  sha256: string;
  bytes: number;
}

interface SourceManifest {
  generated_at: string;
  status: string;
  source_docs: unknown[];
  files: ManifestFile[];
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(projectRoot, "..", "FitCoach_3_DOCUMENTS_SYNCED_2026-10-14");
const manifestPath = path.join(sourceRoot, "MANIFEST_SHA256.json");
const apply = process.argv.includes("--apply");

const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
if (!isManifest(parsed)) throw new Error("Unexpected source manifest shape");
if (parsed.status !== "DOCUMENT_SYNC_ONLY") throw new Error("Unexpected source status");

const files = [...parsed.files];
const revisionLog = "00-S02_REVISION_LOG.md";
if (!files.some((entry) => entry.path === revisionLog)) {
  files.push({ path: revisionLog, sha256: "", bytes: 0 });
}
files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);

const updatedFiles: ManifestFile[] = [];
for (const entry of files) {
  const absolutePath = path.resolve(sourceRoot, entry.path.replaceAll("/", path.sep));
  if (!absolutePath.startsWith(sourceRoot + path.sep)) {
    throw new Error(`Manifest path escapes source root: ${entry.path}`);
  }
  const bytes = await readFile(absolutePath);
  updatedFiles.push({
    path: entry.path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  });
}

const updated: SourceManifest = {
  ...parsed,
  generated_at: "2026-10-15",
  files: updatedFiles,
};
const output = JSON.stringify(updated, null, 2) + "\n";
const hash = createHash("sha256").update(output).digest("hex");
if (apply) {
  await writeFile(manifestPath, output, "utf8");
  console.log(`Updated manifest: ${updatedFiles.length} files, sha256=${hash}`);
} else {
  console.log(`Manifest preview: ${updatedFiles.length} files, sha256=${hash}; pass --apply to write`);
}

function isManifest(value: unknown): value is SourceManifest {
  if (typeof value !== "object" || value === null) return false;
  if (!("generated_at" in value) || typeof value.generated_at !== "string") return false;
  if (!("status" in value) || typeof value.status !== "string") return false;
  if (!("source_docs" in value) || !Array.isArray(value.source_docs)) return false;
  if (!("files" in value) || !Array.isArray(value.files)) return false;
  return value.files.every((entry: unknown) =>
    typeof entry === "object" && entry !== null &&
    "path" in entry && typeof entry.path === "string" &&
    "sha256" in entry && typeof entry.sha256 === "string" &&
    "bytes" in entry && typeof entry.bytes === "number"
  );
}
