type Preference = Readonly<{ themeId: string | null; accentId: string | null }>;

/** Read adapter only: no SQL migration or changes to client/training records. */
export function migrateThemePreference(value: Preference): Preference {
  const aliases: Readonly<Record<string, readonly [string, string]>> = {
    zefirka: ["warm-sand", "caramel"],
    "graphite-teal": ["night-mocha", "lavender"],
    "polar-teal": ["sage-milk", "pine"],
    "glacier-blue": ["slate-blue", "steel-blue"],
    "obsidian-amber": ["night-mocha", "amber"],
    "sandstone-amber": ["warm-sand", "golden-sand"],
    "noir-crimson": ["dusty-terracotta", "coral"],
    "brown-copper": ["night-mocha", "latte"],
    "graphite-rose": ["graphite-latte", "taupe"],
  };
  const alias = value.themeId === null || !Object.hasOwn(aliases, value.themeId) ? undefined : aliases[value.themeId];
  if (alias) return { themeId: alias[0], accentId: alias[1] };
  if (value.themeId === "slate-blue" && (value.accentId === "blue" || value.accentId === "violet")) {
    return { themeId: "slate-blue", accentId: value.accentId === "blue" ? "steel-blue" : "cobalt" };
  }
  return value;
}
