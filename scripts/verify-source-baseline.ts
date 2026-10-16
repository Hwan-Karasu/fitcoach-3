import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestEntry {
  path: string;
  sha256: string;
  bytes: number;
}

interface SourceManifest {
  status: string;
  files: ManifestEntry[];
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.resolve(
  projectRoot,
  "..",
  "FitCoach_3_DOCUMENTS_SYNCED_2026-10-14",
);
const manifestPath = path.join(sourceRoot, "MANIFEST_SHA256.json");
const expectedManifestHash =
  "b1d3a6e0cef468ef40919287e12f7dffc869f9a6d2961e6274f7acb26c09045f";

const manifestBytes = await readFile(manifestPath);
const manifestHash = sha256(manifestBytes);
if (manifestHash !== expectedManifestHash) {
  fail(`manifest hash mismatch: expected ${expectedManifestHash}, got ${manifestHash}`);
}

const manifest: unknown = JSON.parse(manifestBytes.toString("utf8"));
if (!isSourceManifest(manifest)) {
  fail("manifest must contain a status and typed file entries");
}
if (manifest.status !== "DOCUMENT_SYNC_ONLY") {
  fail(`unexpected package status: ${String(manifest.status)}`);
}
const listed = new Set<string>();
for (const entry of manifest.files) {
  const relativePath = String(entry.path).replaceAll("/", path.sep);
  const absolutePath = path.resolve(sourceRoot, relativePath);
  if (!isInside(sourceRoot, absolutePath)) {
    fail(`manifest path escapes source root: ${entry.path}`);
  }
  const bytes = await readFile(absolutePath);
  const actualHash = sha256(bytes);
  if (actualHash !== entry.sha256) {
    fail(`hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${actualHash}`);
  }
  if (bytes.byteLength !== entry.bytes) {
    fail(`size mismatch for ${entry.path}: expected ${entry.bytes}, got ${bytes.byteLength}`);
  }
  listed.add(normalize(entry.path));
}

const actualFiles = await listFiles(sourceRoot);
const allowedUnlisted = new Set(["MANIFEST_SHA256.json"]);
const unexpected = actualFiles.filter(
  (file) => !listed.has(file) && !allowedUnlisted.has(file),
);
if (unexpected.length > 0) {
  fail(`unlisted source files: ${unexpected.join(", ")}`);
}

console.log(
  `Source baseline OK: ${manifest.files.length} manifest entries, status=${manifest.status}, manifest=${manifestHash}`,
);

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalize(value: string): string {
  return value.replaceAll("\\", "/");
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function listFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const nested of await listFiles(absolute)) {
        result.push(normalize(path.join(entry.name, nested)));
      }
    } else if (entry.isFile()) {
      result.push(normalize(entry.name));
    } else {
      const info = await stat(absolute);
      if (info.isFile()) result.push(normalize(entry.name));
    }
  }
  return result;
}

function isSourceManifest(value: unknown): value is SourceManifest {
  if (!isRecord(value) || typeof value.status !== "string") return false;
  if (!Array.isArray(value.files)) return false;
  return value.files.every(
    (entry: unknown) =>
      isRecord(entry) &&
      typeof entry.path === "string" &&
      /^[a-f0-9]{64}$/.test(String(entry.sha256)) &&
      typeof entry.bytes === "number" &&
      Number.isSafeInteger(entry.bytes) &&
      entry.bytes >= 0,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  console.error(`Source baseline FAILED: ${message}`);
  process.exit(1);
}

