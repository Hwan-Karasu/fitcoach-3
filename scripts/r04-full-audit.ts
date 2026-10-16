import { hasSingleAuditCopyArgument } from "./r03/AuditLegacyCopy.ts";
import { auditR04FullCopy } from "./r04/AuditR04FullCopy.ts";

const paths = process.argv.slice(2);
if (!hasSingleAuditCopyArgument(paths)) {
  process.stderr.write("USAGE: npm run r04:full -- <read-only-source.atbackup>\n");
  process.exitCode = 2;
} else {
  const report = auditR04FullCopy(paths[0]!);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "blocked") process.exitCode = 1;
}
