import { writeFile } from "node:fs/promises";
import { appThemes } from "../apps/mobile/src/shared/ui/theme/themes.ts";
import { resolvePalette } from "../apps/mobile/src/shared/ui/theme/resolver.ts";
import { contrastRatio } from "../apps/mobile/src/shared/ui/theme/colorAlpha.ts";

const rows: string[] = [];
const adjustments: string[] = [];
let failed = 0;
for (const theme of appThemes) {
  for (const accent of theme.accentSwatches) {
    const c = resolvePalette({ themeId: theme.id, accentId: accent.id }, "warm-sand").tokens;
    for (const [role, source, resolved] of [
      ["textSecondary", theme.secondary, c.textSecondary], ["textMuted", theme.muted, c.textMuted],
      ["accentInk", accent.hex, c.accentInk], ["onAccentSoft", accent.onSoft, c.onAccentSoft],
      ["controlBorder", theme.border, c.controlBorder],
    ]) if (source !== resolved) adjustments.push(`| ${theme.id} / ${accent.id} | ${role} | ${source} | ${resolved} |`);
    const pairs: Array<readonly [string, string, string, number]> = [];
    for (const background of ["canvas", "surface", "surfaceRaised", "input", "navigation"] as const) {
      for (const text of ["textPrimary", "textSecondary", "textMuted"] as const) pairs.push([`${text}/${background}`, c[text], c[background], 4.5]);
      for (const icon of ["iconPrimary", "iconSecondary", "focusRing"] as const) pairs.push([`${icon}/${background}`, c[icon], c[background], 3]);
    }
    for (const status of ["success", "warning", "danger", "info", "accentInk"] as const) {
      for (const background of ["canvas", "surface", "surfaceRaised", "input"] as const) pairs.push([`${status}/${background}`, c[status], c[background], 4.5]);
    }
    for (const ink of ["textPrimary", "textSecondary", "textMuted", "accentInk"] as const) pairs.push([`${ink}/soft`, c[ink], c.accentSoft, 4.5]);
    pairs.push(["button", c.onAccentFill, c.accentFill, 4.5], ["pressed", c.onAccentFill, c.accentPressed, 4.5],
      ["soft", c.onAccentSoft, c.accentSoft, 4.5], ["input boundary", c.controlBorder, c.input, 3]);
    const failures = pairs.filter(([, fg, bg, minimum]) => contrastRatio(fg, bg) < minimum);
    failed += failures.length;
    rows.push(`| ${theme.id} / ${accent.id} | ${pairs.length - failures.length}/${pairs.length} | ${failures.map(([name, fg, bg]) => `${name}: ${contrastRatio(fg, bg).toFixed(2)}`).join("; ") || "—"} |`);
  }
}
const output = `# Z01 — contrast audit\n\nComputed from runtime tokens (58 pairs per combination, 1044 total). Decorative borders are not subject to the control-boundary threshold. Disabled opacity, overlays, charts and Android pixels require separate checks.\n\n| Combination | Passing pairs | Below threshold |\n|---|---|---|\n${rows.join("\n")}\n\nBelow threshold: ${failed} (includes repeated neutral pairs across accents).\n`;
console.log(output);
await writeFile(new URL("../docs/ui/themes/CONTRAST_AUDIT.md", import.meta.url), output);
await writeFile(new URL("../docs/ui/themes/TOKEN_ADJUSTMENTS.md", import.meta.url),
  `# Z01 — contrast corrections\n\nOriginal JSON is unchanged. Text inks mix toward the primary text until reaching 4.5:1 on their supported surfaces. Neutral text uses all three soft accents, so changing accent does not change neutral text. Control boundaries use the supplied iconSecondary token (3:1); decorative border stays unchanged. Accent base, pressed and soft fills stay exact. Week-context ink uses the same formula separately.\n\n| Combination | Role | Source | Runtime |\n|---|---|---|---|\n${adjustments.join("\n")}\n`);
if (failed > 0) process.exitCode = 1;
