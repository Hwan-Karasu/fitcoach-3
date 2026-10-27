/** One ordered queue for autosave, publication and explicit deletion. */
export class RecoveryDraftQueue<T> {
  private pending: T | undefined;
  private latest: { value: T } | null = null;
  private queued = false;
  private chain: Promise<void> = Promise.resolve();
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly write: (value: T) => Promise<void>;
  private readonly onError: (error: unknown) => void;
  constructor(write: (value: T) => Promise<void>, onError: (error: unknown) => void) { this.write = write; this.onError = onError; }
  schedule(value: T): void {
    if (this.paused) return;
    this.latest = { value };
    this.pending = value; this.queued = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.flush().catch(this.onError); }, 800);
  }
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (!this.queued) { await this.chain; return; }
    const value = this.pending!; this.pending = undefined; this.queued = false;
    const operation = this.chain.catch(() => undefined).then(() => this.write(value));
    this.chain = operation;
    try { await operation; } catch (error) {
      if (!this.queued && !this.paused) { this.pending = value; this.queued = true; }
      throw error;
    }
  }
  async publish(): Promise<void> { do { await this.flush(); } while (this.queued); this.paused = true; }
  async discard(remove: () => Promise<void>): Promise<void> {
    const pending = this.pending; const queued = this.queued;
    this.paused = true;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.pending = undefined; this.queued = false;
    await this.chain.catch(() => undefined);
    try { await remove(); } catch (error) {
      this.paused = false; this.pending = this.latest?.value ?? pending; this.queued = this.latest !== null || queued; throw error;
    }
  }
  resume(): void { this.paused = false; }
  dispose(): void {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (!this.paused) void this.flush().catch(this.onError);
  }
}
