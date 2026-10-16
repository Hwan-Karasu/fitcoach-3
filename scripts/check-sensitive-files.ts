import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectSensitiveLine, inspectSensitivePath } from "./sensitive-file-rules.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skippedDirectories = new Set([
  ".git", "node_modules", ".expo", ".cache", ".gradle", ".gradle-cache",
  "android", "ios", "dist", "build", "coverage", ".npm-cache",
]);
const readable = /(?:\.(?:ts|tsx|json|md|yml|yaml|xml|gradle|properties|html|css|txt)|^\.gitignore)$/iu;
const findings: string[] = [];

async function scan(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) await scan(absolute);
      continue;
    }
    if (!entry.isFile()) continue;
    const relative = path.relative(root, absolute).replaceAll(path.sep, "/");
    for (const finding of inspectSensitivePath(relative)) {
      findings.push(`${relative}: ${finding}`);
    }
    if (!readable.test(entry.name)) continue;
    const lines = (await readFile(absolute, "utf8")).split(/\r?\n/u);
    for (let index = 0; index < lines.length; index += 1) {
      for (const finding of inspectSensitiveLine(lines[index]!)) {
        findings.push(`${relative}:${index + 1}: ${finding}`);
      }
    }
  }
}

await scan(root);
if (findings.length > 0) {
  for (const finding of findings) console.error(finding);
  process.exitCode = 1;
} else {
  console.log("No high-confidence credentials or sensitive files found in project sources.");
}
