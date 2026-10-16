import type { SqliteStatementPort } from "../shared/db/SqlitePort.ts";
import type { WriterCoordinator } from "../shared/db/WriterCoordinator.ts";
import type { DomainChangeManifest } from "./QueryRegistry.ts";

export interface CommittedResult<T> {
  readonly value: T;
  readonly changes: readonly DomainChangeManifest[];
}

export interface ChangePublisher {
  publish(changes: readonly DomainChangeManifest[]): void;
}

/** Never publish an uncommitted change or report a failed transaction as success. */
export async function writeWithChanges<T>(
  writer: WriterCoordinator,
  task: (tx: SqliteStatementPort) => Promise<CommittedResult<T>>,
  publisher: ChangePublisher,
): Promise<T> {
  const committed = await writer.write(task);
  publisher.publish(committed.changes);
  return committed.value;
}
