/** A query identity includes its full scope; parameters must be canonical for the caller. */
export interface QueryKey {
  readonly kind: string;
  readonly workspaceId: string;
  readonly clientId?: string;
  readonly parameters?: string;
  readonly localDate?: string;
}

export interface QueryDependency {
  readonly domain: string;
  readonly workspaceId: string;
  /** Omit to depend on changes for every client in the workspace. */
  readonly clientId?: string;
  /** Omit to depend on every entity in this domain and scope. */
  readonly entityIds?: readonly string[];
}

/** Emitted only after a successful transaction commit. */
export interface DomainChangeManifest {
  readonly domain: string;
  readonly workspaceId: string;
  readonly clientId?: string;
  /** Omit for a broad domain change (for example, import or restore). */
  readonly entityIds?: readonly string[];
}

export type QuerySnapshot<T> =
  | { readonly status: "loading"; readonly revision: 0 }
  | { readonly status: "error"; readonly revision: 0 }
  | { readonly status: "ready"; readonly revision: number; readonly data: T; readonly refreshing: boolean; readonly refreshFailed: boolean };

export interface QueryHandle<T> {
  getSnapshot(): QuerySnapshot<T>;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  dispose(): void;
}

interface RegistryEntry {
  readonly dependencies: readonly QueryDependency[];
  refresh(): void;
  dispose(): void;
}

function keyId(key: QueryKey): string {
  return JSON.stringify([key.kind, key.workspaceId, key.clientId ?? null, key.parameters ?? null, key.localDate ?? null]);
}

function overlaps(dependency: QueryDependency, change: DomainChangeManifest): boolean {
  if (dependency.domain !== change.domain || dependency.workspaceId !== change.workspaceId) return false;
  if (dependency.clientId !== undefined && change.clientId !== undefined && dependency.clientId !== change.clientId) return false;
  if (dependency.entityIds === undefined || change.entityIds === undefined) return true;
  return dependency.entityIds.some((id) => change.entityIds?.includes(id));
}

/** Transient read snapshots only: owners retain all business facts and writes. */
export class QueryRegistry {
  private readonly entries = new Map<string, RegistryEntry>();

  register<T>(key: QueryKey, dependencies: readonly QueryDependency[], load: () => Promise<T>): QueryHandle<T> {
    const id = keyId(key);
    if (this.entries.has(id)) throw new Error("QUERY_ALREADY_REGISTERED");
    if (dependencies.length === 0 || dependencies.some((dependency) => dependency.workspaceId !== key.workspaceId)) {
      throw new Error("QUERY_DEPENDENCIES_INVALID");
    }

    let snapshot: QuerySnapshot<T> = { status: "loading", revision: 0 };
    let generation = 0;
    let disposed = false;
    const listeners = new Set<() => void>();
    const notify = () => {
      // A broken screen subscriber cannot make a committed business write look failed.
      for (const listener of listeners) {
        try { listener(); } catch { /* The next snapshot remains available to other listeners. */ }
      }
    };
    const publish = (next: QuerySnapshot<T>) => { snapshot = next; notify(); };

    const entry: RegistryEntry & QueryHandle<T> = {
      dependencies: [...dependencies],
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        if (disposed) throw new Error("QUERY_DISPOSED");
        listeners.add(listener);
        return () => { listeners.delete(listener); };
      },
      refresh: () => {
        if (disposed) return;
        const request = ++generation;
        if (snapshot.status === "ready") {
          publish({ ...snapshot, refreshing: true, refreshFailed: false });
        } else {
          publish({ status: "loading", revision: 0 });
        }
        void Promise.resolve().then(load).then(
          (data) => {
            if (disposed || request !== generation) return;
            const revision = snapshot.status === "ready" ? snapshot.revision + 1 : 1;
            publish({ status: "ready", revision, data, refreshing: false, refreshFailed: false });
          },
          () => {
            if (disposed || request !== generation) return;
            if (snapshot.status === "ready") publish({ ...snapshot, refreshing: false, refreshFailed: true });
            else publish({ status: "error", revision: 0 });
          },
        );
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        generation += 1;
        listeners.clear();
        if (this.entries.get(id) === entry) this.entries.delete(id);
      },
    };
    this.entries.set(id, entry);
    entry.refresh();
    return entry;
  }

  /** Each matching query refreshes once for an entire committed change batch. */
  publish(changes: readonly DomainChangeManifest[]): void {
    if (changes.length === 0) return;
    for (const entry of this.entries.values()) {
      if (entry.dependencies.some((dependency) => changes.some((change) => overlaps(dependency, change)))) entry.refresh();
    }
  }

  dispose(): void {
    for (const entry of this.entries.values()) entry.dispose();
  }
}
