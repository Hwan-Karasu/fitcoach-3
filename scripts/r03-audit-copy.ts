import { auditLegacyCopy, hasSingleAuditCopyArgument } from "./r03/AuditLegacyCopy.ts";

const paths = process.argv.slice(2);
if (!hasSingleAuditCopyArgument(paths)) {
  process.stderr.write("USAGE: npm run r03:audit -- <temporary-copy.atbackup>\n");
  process.exitCode = 2;
} else {
  const report = auditLegacyCopy(paths[0]!);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "blocked") process.exitCode = 1;
}
