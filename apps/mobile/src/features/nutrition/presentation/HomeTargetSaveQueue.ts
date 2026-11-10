import type { NutritionTargetsPort } from "../domain/NutritionTargetsPort.ts";
import type { TargetVersion, TargetVersionInput } from "../domain/TargetModel.ts";

/** Записи по порядку и ACK именно своего черновика: поздний ответ не стирает новый ввод. */
export class HomeTargetSaveQueue {
  private versions: readonly TargetVersion[] = [];
  private edited = 0;
  private requested = -1;
  private tail: Promise<unknown> = Promise.resolve();
  private last: Promise<Readonly<{ edit: number; saved: TargetVersion }>> | null = null;

  private readonly clientId: string;
  private readonly targets: Pick<NutritionTargetsPort, "saveVersion">;
  constructor(clientId: string, targets: Pick<NutritionTargetsPort, "saveVersion">) { this.clientId = clientId; this.targets = targets; }

  adopt(versions: readonly TargetVersion[]): void {
    const merged = new Map(this.versions.map((version) => [version.id, version]));
    for (const version of versions) if ((merged.get(version.id)?.revision ?? 0) <= version.revision) merged.set(version.id, version);
    this.versions = [...merged.values()];
  }
  markEdited(): void { this.edited += 1; }
  isCurrent(edit: number): boolean { return this.edited === edit; }

  save(input: TargetVersionInput): Promise<Readonly<{ edit: number; saved: TargetVersion }>> {
    const edit = this.edited;
    if (this.requested === edit && this.last !== null) return this.last;
    this.requested = edit;
    const write = this.tail.then(async () => {
      const same = this.versions.find((version) => version.effectiveFrom === input.effectiveFrom);
      const saved = await this.targets.saveVersion(this.clientId, input, same?.revision ?? null);
      this.adopt([saved]);
      return { edit, saved };
    });
    this.tail = write.catch(() => { if (this.requested === edit) this.requested = -1; });
    this.last = write;
    return write;
  }
}
