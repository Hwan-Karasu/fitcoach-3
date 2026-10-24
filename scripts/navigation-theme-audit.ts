import { writeFile } from "node:fs/promises";
import { appThemes } from "../apps/mobile/src/shared/ui/theme/themes.ts";
import { resolvePalette, type PaletteTokens } from "../apps/mobile/src/shared/ui/theme/resolver.ts";
import { contrastRatio } from "../apps/mobile/src/shared/ui/theme/colorAlpha.ts";
import { navigationBorder } from "../apps/mobile/src/shared/ui/theme/navigationBorder.ts";
import { tintPalette } from "../apps/mobile/src/shared/ui/theme/tintPalette.ts";

const rows: string[] = [];
const previews: string[] = [];
const violations: string[] = [];
function check(c: PaletteTokens, name: string) {
  const border = navigationBorder(c);
  const pairs: Array<[string, string, string, number]> = [
    ["border/page", border, c.canvas, 1.5], ["border/bar", border, c.navigation, 1.5],
    ["label", c.textSecondary, c.navigation, 4.5], ["icon", c.iconSecondary, c.navigation, 3],
    ["accent", c.accentInk, c.navigation, 4.5], ["selected", c.onAccentSoft, c.accentSoft, 4.5],
  ];
  for (const [role, foreground, background, minimum] of pairs) {
    if (contrastRatio(foreground, background) < minimum) violations.push(`${name}: ${role}`);
  }
  rows.push(`| ${name} | ${c.navigation} | ${border} | ${pairs.map(([, fg, bg]) => contrastRatio(fg, bg).toFixed(2)).join(" / ")} |`);
}
function bar(c: PaletteTokens) {
  return `<div class="bar" style="background:${c.navigation};border-color:${navigationBorder(c)};color:${c.iconSecondary}">
    <div class="tabs"><span>⌂<small>Главная</small></span><span>♧<small>Питание</small></span><span class="active" style="background:${c.accentSoft};color:${c.onAccentSoft}">↗<small>Тренировки</small></span><span>•••<small>Ещё</small></span></div>
    <div class="shortcut" style="color:${c.accentInk}">К списку клиентов</div></div>`;
}
for (const theme of appThemes) for (const accent of theme.accentSwatches) {
  const c = resolvePalette({ themeId: theme.id, accentId: accent.id }, "warm-sand").tokens;
  const name = `${theme.id} / ${accent.id}`;
  check(c, name);
  for (const [kind, tone] of Object.entries({ success: c.success, warning: c.warning, danger: c.danger, blue: c.charts[1] })) {
    check(tintPalette(c, tone), `${name} / week:${kind}`);
  }
  const week = tintPalette(c, c.success);
  previews.push(`<article style="background:${c.canvas};color:${c.textPrimary}"><h2>${theme.name} · ${accent.name}</h2>
    <div class="sample" style="background:${c.surface}">Карточка на фоне экрана</div>${bar(c)}
    <div class="week" style="background:${week.canvas}"><small>С окраской недели</small>${bar(week)}</div></article>`);
}
const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Навигация — 18 сочетаний</title>
<style>*{box-sizing:border-box}body{margin:0;padding:20px;background:#ddd;font:14px system-ui}h1{margin:0 0 8px}p{margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}article{padding:16px;border-radius:20px}h2{font-size:15px;margin:0 0 10px}.sample{padding:10px;border-radius:12px;margin-bottom:10px}.bar{border:1px solid;border-radius:22px;padding:6px;box-shadow:0 5px 12px #0002}.tabs{display:flex;gap:4px}.tabs span{flex:1;text-align:center;border-radius:14px;padding:5px;font-size:22px}.tabs small{display:block;font-size:11px}.shortcut{text-align:center;padding:8px 0 4px;font-weight:600}.week{margin-top:10px;padding:8px;border-radius:14px}.week>small{display:block;margin-bottom:6px}</style>
<h1>Панель навигации: 6 тем × 3 акцента</h1><p>Макет по runtime-токенам; нативная геометрия отдельно проверяется на Android.</p><div class="grid">${previews.join("\n")}</div></html>`;
await writeFile(new URL("../docs/ui/themes/NAVIGATION_PREVIEW.html", import.meta.url), html);
await writeFile(new URL("../docs/ui/themes/NAVIGATION_AUDIT.md", import.meta.url),
  `# Navigation separation audit\n\n18 base combinations + 72 week contexts. Six contrast pairs per state (540 total). Decorative border target 1.5:1 on each side is a visual separation criterion, not a WCAG control-boundary claim. Text 4.5:1, inactive icons 3:1. Disabled opacity and native pressed states need Android inspection.\n\nNavigation uses the theme input surface; the supplied JSON remains unchanged. The outline is corrected toward iconSecondary only as far as needed.\n\n| State | Bar | Outline | Border/page · border/bar · label · icon · accent · selected |\n|---|---|---|---|\n${rows.join("\n")}\n\nFailures: ${violations.length}\n`);
console.log(`${rows.length} states, ${rows.length * 6} contrast pairs, ${violations.length} failures. Preview and report written.`);
if (violations.length) { console.error(violations.join("\n")); process.exitCode = 1; }
