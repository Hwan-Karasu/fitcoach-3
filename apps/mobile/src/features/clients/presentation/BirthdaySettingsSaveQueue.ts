import type { ClientRosterPort, RosterBirthdaySettings } from "../domain/ClientRosterPort.ts";
import { nextBirthdaySettings } from "../domain/BirthdaySettingsRules.ts";

/** После сбоя следующий патч накладывается на сохранённое, а поздний ответ не откатывает новый выбор. */
export class BirthdaySettingsSaveQueue {
  private saved: RosterBirthdaySettings | null = null;
  private shown: RosterBirthdaySettings | null = null;
  private sequence = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private readonly repository: Pick<ClientRosterPort, "getBirthdaySettings" | "setBirthdaySettings">;
  constructor(repository: Pick<ClientRosterPort, "getBirthdaySettings" | "setBirthdaySettings">) { this.repository = repository; }
  get value() { return this.shown; }
  isLatest(sequence: number) { return sequence === this.sequence; }
  async load(): Promise<RosterBirthdaySettings> {
    for (;;) {
      const tail = this.tail;
      await tail;
      const sequence = this.sequence;
      const settings = await this.repository.getBirthdaySettings();
      if (tail !== this.tail || sequence !== this.sequence) continue;
      this.saved = settings; this.shown = settings;
      return settings;
    }
  }
  commit(patch: Partial<RosterBirthdaySettings>) {
    if (this.shown === null) return null;
    const next = nextBirthdaySettings(this.shown, patch);
    if (next === null) return null;
    const sequence = ++this.sequence;
    this.shown = next;
    const result = this.tail.then(async () => {
      try {
        const base = this.saved ?? await this.repository.getBirthdaySettings();
        const candidate = nextBirthdaySettings(base, patch);
        if (candidate !== null) await this.repository.setBirthdaySettings(candidate);
        this.saved = candidate ?? base;
        if (this.isLatest(sequence)) this.shown = this.saved;
      } catch (error) {
        this.saved = await this.repository.getBirthdaySettings().catch(() => this.saved);
        if (this.isLatest(sequence)) this.shown = this.saved;
        throw error;
      }
    });
    this.tail = result.catch(() => undefined);
    return { next, sequence, result };
  }
}
