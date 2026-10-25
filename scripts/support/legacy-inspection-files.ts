import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { InspectionCopyError, inspectionOperationId } from "../../apps/mobile/src/features/legacy-import/domain/InspectionCopy.ts";
import type { LegacyInspectionReader } from "../../apps/mobile/src/features/legacy-import/data/LegacyInspectionCopy.ts";

const digest = (path: string) => { const bytes = readFileSync(path); return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; };
/** Synthetic real-file adapter; never points at a user's selected backup. */
export function createInspectionFiles(source: string, root: string) {
  const calls: string[] = [], opened: string[] = [], queries: string[] = [];
  const handles = new Set<DatabaseSync>();
  const state: { hook: ((phase: string) => void) | null } = { hook: null };
  const point = (phase: string) => { calls.push(phase); state.hook?.(phase); };
  const path = (op: string, name: string) => { assert.ok(inspectionOperationId(op)); return join(root, op, name); };
  const inspect = (file: string) => {
    if (!existsSync(file)) throw new InspectionCopyError("SOURCE_COPY_INVALID");
    return { digest: digest(file), header: readFileSync(file).subarray(0, 16), hasSidecars: ["-wal", "-shm", "-journal"].some((suffix) => existsSync(file + suffix)) };
  };
  const files: LegacyInspectionReader = {
    async hashSource() { point("hash-source"); return digest(source); },
    async reserve(op) {
      point("reserve"); if (existsSync(join(root, op))) throw new InspectionCopyError("SOURCE_COPY_EXISTS");
      mkdirSync(root, { recursive: true }); mkdirSync(join(root, op)); writeFileSync(path(op, "source.partial"), "", { flag: "wx" }); point("after-reserve");
    },
    async copyToPartial(op) { point("copy"); copyFileSync(source, path(op, "source.partial")); point("after-copy"); },
    async inspectPartial(op) { point("inspect-partial"); return inspect(path(op, "source.partial")); },
    async seal(op, receipt) {
      point("seal"); renameSync(path(op, "source.partial"), path(op, "source.sqlite")); point("after-file-publish");
      writeFileSync(path(op, "receipt.partial"), JSON.stringify(receipt), { flag: "wx" }); point("after-receipt-write");
      renameSync(path(op, "receipt.partial"), path(op, "receipt.json")); point("after-receipt-publish");
    },
    async inspectReady(op) {
      point("inspect-ready"); if (!existsSync(path(op, "receipt.json"))) throw new InspectionCopyError("SOURCE_COPY_INVALID");
      return { ...inspect(path(op, "source.sqlite")), receipt: JSON.parse(readFileSync(path(op, "receipt.json"), "utf8")) as unknown };
    },
    async openReady(op) {
      point("open-sqlite"); const file = path(op, "source.sqlite"); opened.push(file); const connection = new DatabaseSync(file); handles.add(connection);
      return { getAllAsync: async <Row>(sql: string, ...bindings: unknown[]): Promise<Row[]> => { queries.push(sql); return connection.prepare(sql).all(...bindings as SQLInputValue[]) as Row[]; },
        execAsync: async (sql: string) => { connection.exec(sql); }, closeAsync: async () => { connection.close(); handles.delete(connection); point("after-sqlite-close"); } };
    },
  };
  return { root, source, files, calls, opened, queries, state, path, handles };
}
