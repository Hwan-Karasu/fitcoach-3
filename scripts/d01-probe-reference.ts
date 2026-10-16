import { readFileSync } from "node:fs";
import { probeReferenceOwnerGuards } from "./d01/ProbeReferenceSchema.ts";

const paths = process.argv.slice(2);
if (paths.length !== 1 || !paths[0]?.toLowerCase().endsWith(".sql")) {
  process.stderr.write("USAGE: node --experimental-strip-types scripts/d01-probe-reference.ts <reference.sql>\n");
  process.exitCode = 2;
} else {
  try {
    const report = probeReferenceOwnerGuards(readFileSync(paths[0], "utf8"));
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch {
    process.stderr.write("D01_REFERENCE_PROBE_FAILED\n");
    process.exitCode = 1;
  }
}
