import { hasSingleAuditCopyArgument } from "./r03/AuditLegacyCopy.ts";
import { auditLegacyTableCoverageFile } from "./r04/AuditLegacyTableCoverage.ts";

const paths = process.argv.slice(2);
if (!hasSingleAuditCopyArgument(paths)) {
  process.stderr.write("USAGE: npm run r04:coverage -- <read-only-source.atbackup>\n");
  process.exitCode = 2;
} else {
  const report = auditLegacyTableCoverageFile(paths[0]!);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status !== "requires-mapping") process.exitCode = 1;
}
