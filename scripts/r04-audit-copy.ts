import { auditSourceFactCopy, hasSingleAuditCopyArgument } from "./r04/AuditSourceFactCopy.ts";

const paths = process.argv.slice(2);
if (!hasSingleAuditCopyArgument(paths)) {
  process.stderr.write("USAGE: npm run r04:audit -- <read-only-source.atbackup>\n");
  process.exitCode = 2;
} else {
  const report = auditSourceFactCopy(paths[0]!);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "blocked") process.exitCode = 1;
}
