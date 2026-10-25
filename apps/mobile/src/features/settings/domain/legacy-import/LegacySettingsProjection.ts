import type { LegacySettingsSource } from "../../../../shared/migration/LegacySettingsSource.ts";
import type { AppearanceSetting } from "../SettingsPort.ts";
import { DEFAULT_CLIENT_CARDS, type ClientCardPreference, type ClientMetricId, type ClientStartSection } from "../../../../shared/domain/ClientCardPreference.ts";
import { parseRoundTripSourceJson } from "../../../../shared/migration/SourceJson.ts";

export type LegacySettingDisposition = "APPLIED" | "APPLIED_WITH_REVIEW" | "REVIEW_REQUIRED" | "DELEGATED_CALENDAR" | "TECHNICAL_RESET";
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const metrics: Readonly<Record<string, ClientMetricId>> = { weight: "weight", pack: "credits", program: "credits", calories: "calories", visit: "lastTraining", steps: "steps", fatPercent: "fatPercent" };
const sections: Readonly<Record<string, ClientStartSection>> = { home: "Home", kbju: "Nutrition", training: "Training", profile: "More", archive: "More" };
const resets = new Set(["navigation_resume_v1", "recent_client_v1", "rest_timer_state_v1", "exact_alarm_prompted_v1", "notification_sync_status_v1", "release_notes_version", "last_auto_backup_at", "last_auto_backup_error", "legacy_import_offer"]);

/** Pinned 2.0 settings meanings, not its permissive default/rounding normalizers.
 * Unsupported optional preferences remain explicit raw review, never block facts.
 * Theme aliases are already understood by the normal 3.x theme read adapter.
 */
export function projectLegacySettings(source: LegacySettingsSource) {
  const appearance: { -readonly [Key in keyof AppearanceSetting]: AppearanceSetting[Key] } = { themeId: "graphite-teal", accentId: null };
  let applied = false;
  const seen = new Set<string>();
  const sourceRows = [...source.rows ?? []].sort((a, b) => compare(String(a.key), String(b.key))).map((raw) => {
    if (typeof raw.key !== "string" || !raw.key.trim() || seen.has(raw.key)) throw new Error("R04_ID_LEDGER_SETTINGS_IDENTITY_INVALID");
    seen.add(raw.key);
    const key = raw.key, issues: string[] = [];
    let disposition: LegacySettingDisposition = "REVIEW_REQUIRED", targetKey: "appearance" | null = null;
    if (key === "theme") {
      if (raw.value === "light" || raw.value === "dark") {
        appearance.themeId = raw.value === "light" ? "polar-teal" : "graphite-teal";
        applied = true; targetKey = "appearance"; disposition = "APPLIED";
      } else issues.push("THEME_UNSUPPORTED");
    } else if (key === "client_card_ui_settings") {
      try {
        const parsed = typeof raw.value === "string" ? parseRoundTripSourceJson(raw.value) : null;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("INVALID");
        const card = parsed as Record<string, unknown>;
        const options: { showClientListShortcut?: boolean; hideNavigationLabels?: boolean; clientCards?: ClientCardPreference } = {};
        const mapped: { -readonly [Key in keyof ClientCardPreference]: ClientCardPreference[Key] } = { ...DEFAULT_CLIENT_CARDS };
        let usedCard = false, used = false;
        for (const [old, next, invert] of [["showBackToClients", "showClientListShortcut", false], ["showNavigationLabels", "hideNavigationLabels", true]] as const) {
          if (!Object.hasOwn(card, old)) continue;
          if (typeof card[old] !== "boolean") throw new Error("INVALID");
          options[next] = invert ? !card[old] : card[old]; used = true;
        }
        if (Object.hasOwn(card, "clientCardMetricIds")) {
          const ids = card.clientCardMetricIds;
          if (!Array.isArray(ids) || ids.length < 1 || ids.length > 4 || ids.some((id: unknown) => typeof id !== "string" || !Object.hasOwn(metrics, id))) throw new Error("INVALID");
          const translated = (ids as string[]).map((id) => metrics[id]!);
          if (new Set(translated).size !== translated.length) throw new Error("INVALID");
          mapped.metricIds = translated; usedCard = true;
        }
        if (Object.hasOwn(card, "clientStartTab")) {
          if (typeof card.clientStartTab !== "string" || !Object.hasOwn(sections, card.clientStartTab)) throw new Error("INVALID");
          mapped.startSection = sections[card.clientStartTab]!; usedCard = true;
          if (card.clientStartTab === "profile" || card.clientStartTab === "archive") issues.push("START_TAB_GROUPED_MORE");
        }
        if (Object.hasOwn(card, "showHealthBadge")) {
          if (typeof card.showHealthBadge !== "boolean") throw new Error("INVALID");
          mapped.showHealthBadge = card.showHealthBadge; usedCard = true;
        }
        if (usedCard) {
          options.clientCards = mapped; used = true;
          if (["clientCardMetricIds", "clientStartTab", "showHealthBadge"].some((field) => !Object.hasOwn(card, field))) issues.push("CARD_DEFAULTS_FOR_MISSING_PROPERTIES");
        }
        if (Object.keys(card).some((field) => !["clientCardMetricIds", "clientStartTab", "showHealthBadge", "showBackToClients", "showNavigationLabels"].includes(field))) issues.push("CARD_PROPERTIES_RETAINED");
        if (used) { Object.assign(appearance, options); applied = true; targetKey = "appearance"; disposition = issues.length ? "APPLIED_WITH_REVIEW" : "APPLIED"; }
        else issues.push("CARD_SETTINGS_UNSUPPORTED");
      } catch { issues.push("CARD_SETTINGS_INVALID"); }
    } else if (key === "calendar_planner_settings") disposition = "DELEGATED_CALENDAR";
    else if (resets.has(key)) disposition = "TECHNICAL_RESET";
    else if (/^training_builder_draft(?:_v2)?:/u.test(key)) issues.push("BUILDER_DRAFT_REQUIRES_MAPPING");
    else issues.push("SETTING_REQUIRES_MAPPING");
    if (Object.keys(raw).some((column) => !["key", "value", "updated_at"].includes(column))) issues.push("SOURCE_COLUMNS_RETAINED");
    if (disposition === "APPLIED" && issues.length) disposition = "APPLIED_WITH_REVIEW";
    return { sourceKey: JSON.stringify([source.accountScope, "app_settings", key]), key, raw, disposition, targetKey, issues: [...new Set(issues)].sort(compare) };
  });
  return { appearance: applied ? appearance as AppearanceSetting : null, sourceRows };
}
