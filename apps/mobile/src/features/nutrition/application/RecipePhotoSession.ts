import { photosToDiscard } from "../domain/RecipePhotoRules.ts";

interface PhotoFiles {
  readonly store: (sourceUri: string) => Promise<string>;
  readonly remove: (uri: string) => void;
}
/** Owns provisional copies until the recipe transaction's outcome is known. An editor
 * disappearing during picker/copy/save must never delete a photo that a commit will use. */
export class RecipePhotoSession {
  private readonly files: PhotoFiles;
  private phase: "IDLE" | "COPYING" | "SAVING" = "IDLE";
  private disposed = false;
  private previous: string | null = null;
  private current: string | null = null;
  private persisted: string | null = null;
  private saved = false;
  private readonly picked = new Set<string>();
  constructor(files: PhotoFiles) { this.files = files; }
  get busy(): boolean { return this.phase !== "IDLE"; }
  get isDisposed(): boolean { return this.disposed; }
  setInitial(uri: string | null): void {
    if (this.disposed || this.busy) return;
    this.previous = uri; this.current = uri; this.persisted = uri;
  }
  removePhoto(): boolean {
    if (this.disposed || this.busy) return false;
    this.current = null; return true;
  }
  async choosePhoto(select: () => Promise<string | null>): Promise<string | null> {
    if (this.disposed || this.busy) return null;
    this.phase = "COPYING";
    try {
      const source = await select();
      if (this.disposed || source === null) return null;
      const uri = await this.files.store(source);
      this.picked.add(uri);
      if (this.disposed) return null;
      this.current = uri;
      return uri;
    } finally { this.phase = "IDLE"; this.cleanupIfDisposed(); }
  }
  async persist(writeRecipe: (photoUri: string | null) => Promise<void>): Promise<boolean> {
    if (this.disposed || this.busy) return false;
    this.phase = "SAVING";
    const uri = this.current;
    try {
      await writeRecipe(uri);
      this.persisted = uri; this.saved = true;
      return true;
    } finally { this.phase = "IDLE"; this.cleanupIfDisposed(); }
  }
  dispose(): void { this.disposed = true; this.cleanupIfDisposed(); }
  private cleanupIfDisposed(): void {
    if (!this.disposed || this.busy) return;
    for (const uri of photosToDiscard({ picked: [...this.picked], previous: this.previous, current: this.persisted, saved: this.saved })) {
      try { this.files.remove(uri); } catch { /* Cleanup cannot change a committed recipe outcome. */ }
    }
    this.picked.clear(); this.previous = this.persisted;
  }
}
