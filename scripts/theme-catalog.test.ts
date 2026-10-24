import assert from "node:assert/strict";
import test from "node:test";
import { appThemes as catalogThemes } from "../apps/mobile/src/shared/ui/theme/themes.ts";
import { resolvePalette } from "../apps/mobile/src/shared/ui/theme/resolver.ts";
import { readableInk } from "../apps/mobile/src/shared/ui/theme/colorAlpha.ts";
import { catalogThemes as legacyThemes } from "../apps/mobile/src/shared/ui/theme/catalog.generated.ts";
import { tintPalette } from "../apps/mobile/src/shared/ui/theme/tintPalette.ts";
import { navigationBorder } from "../apps/mobile/src/shared/ui/theme/navigationBorder.ts";

const fallbackThemeId = "warm-sand";

test("navigation is distinct and readable in every theme/accent and week tint", () => {
  for (const theme of catalogThemes) for (const accent of theme.accentSwatches) {
    const base = resolvePalette({ themeId: theme.id, accentId: accent.id }, fallbackThemeId).tokens;
    for (const c of [base, ...[base.success, base.warning, base.danger, base.charts[1]].map((tone) => tintPalette(base, tone))]) {
      const label = `${theme.id}/${accent.id}/${c.navigation}`;
      assert.notEqual(c.navigation, c.canvas, `${label}: page separation`);
      assert.notEqual(c.navigation, c.surface, `${label}: card separation`);
      const outline = navigationBorder(c);
      assert.ok(contrastRatio(outline, c.canvas) >= 1.5, `${label}: outside outline`);
      assert.ok(contrastRatio(outline, c.navigation) >= 1.5, `${label}: inside outline`);
      for (const ink of [c.textPrimary, c.textSecondary, c.accentInk]) {
        assert.ok(contrastRatio(ink, c.navigation) >= 4.5, `${label}: labels`);
      }
      assert.ok(contrastRatio(c.iconSecondary, c.navigation) >= 3, `${label}: inactive icons`);
      assert.ok(contrastRatio(c.onAccentSoft, c.accentSoft) >= 4.5, `${label}: selected tab`);
    }
  }
});

test("runtime snapshot exposes exactly six themes and 18 allowed combinations", () => {
  assert.equal(catalogThemes.length, 6);
  assert.equal(new Set(catalogThemes.map((theme) => theme.id)).size, 6);
  let combinations = 0;
  for (const theme of catalogThemes) {
    assert.equal(theme.accentSwatches.length, 3, theme.id);
    assert.equal(new Set(theme.accentSwatches.map((accent) => accent.id)).size, 3, theme.id);
    assert.ok(theme.accentSwatches.some((accent) => accent.id === theme.accentDefault), theme.id);
    for (const accent of theme.accentSwatches) {
      const resolved = resolvePalette({ themeId: theme.id, accentId: accent.id }, fallbackThemeId);
      assert.equal(resolved.themeId, theme.id);
      assert.equal(resolved.accentId, accent.id);
      assert.equal(resolved.usedThemeFallback, false);
      assert.equal(resolved.usedAccentFallback, false);
      assert.equal(resolved.tokens.accentFill, accent.hex);
      assert.equal(resolved.tokens.onAccentFill, accent.resolvedOnFill);
      assert.equal(resolved.tokens.accentInk, readableInk(accent.resolvedInk,
        [theme.canvas, theme.surface, theme.raised, theme.input, theme.navigation, accent.soft], theme.text));
      assert.equal(resolved.tokens.focusRing, accent.resolvedInk);
      assert.equal(resolved.tokens.charts.length, 4);
      assert.equal(resolved.tokens.success, theme.status.success);
      assert.equal(resolved.tokens.warning, theme.status.warning);
      assert.equal(resolved.tokens.danger, theme.status.danger);
      combinations += 1;
    }
  }
  assert.equal(combinations, 18);
});

test("unknown theme/accent resolves without mutating the stored preference", () => {
  const preference = Object.freeze({ themeId: "deleted-theme", accentId: "deleted-accent" });
  const resolved = resolvePalette(preference, fallbackThemeId);
  assert.equal(resolved.themeId, fallbackThemeId);
  assert.equal(resolved.accentId, "caramel");
  assert.equal(resolved.usedThemeFallback, true);
  assert.equal(resolved.usedAccentFallback, true);
  assert.deepEqual(preference, { themeId: "deleted-theme", accentId: "deleted-accent" });
  const slate = resolvePalette({ themeId: "slate-blue", accentId: "crimson" }, fallbackThemeId);
  assert.equal(slate.themeId, "slate-blue");
  assert.equal(slate.accentId, "steel-blue");
  assert.equal(slate.usedThemeFallback, false);
  assert.equal(slate.usedAccentFallback, true);
  assert.throws(() => resolvePalette(preference, "missing" as typeof fallbackThemeId));
});

test("catalog foreground/background pairs meet limited baseline contrast checks", () => {
  for (const theme of catalogThemes) {
    const bodyContrast = contrastRatio(theme.text, theme.surface);
    assert.ok(bodyContrast >= 4.5, `${theme.id}: primary text/surface ${bodyContrast.toFixed(2)}`);
    for (const accent of theme.accentSwatches) {
      const buttonContrast = contrastRatio(accent.hex, accent.resolvedOnFill);
      const inkContrast = contrastRatio(accent.resolvedInk, theme.surface);
      const inputFocusContrast = contrastRatio(accent.resolvedInk, theme.input);
      assert.ok(buttonContrast >= 4.5,
        `${theme.id}/${accent.id}: onAccentFill ${buttonContrast.toFixed(2)}`);
      assert.ok(inkContrast >= 3,
        `${theme.id}/${accent.id}: accentInk/focusRing ${inkContrast.toFixed(2)}`);
      assert.ok(inputFocusContrast >= 3,
        `${theme.id}/${accent.id}: focusRing/input ${inputFocusContrast.toFixed(2)}`);
    }
  }
});

test("all legacy themes resolve to a supported new theme and accent without changing input", () => {
  for (const legacy of [...legacyThemes, { id: "zefirka", accentSwatches: [{ id: "brand" }] }]) {
    for (const accent of [...legacy.accentSwatches, { id: null }]) {
      const preference = Object.freeze({ themeId: legacy.id, accentId: accent.id });
      const resolved = resolvePalette(preference, fallbackThemeId);
      assert.ok(catalogThemes.some((theme) => theme.id === resolved.themeId && theme.accentSwatches.some((a) => a.id === resolved.accentId)));
      assert.deepEqual(preference, { themeId: legacy.id, accentId: accent.id });
    }
  }
});

test("18 combinations meet text, controls, focus and status contrast across actual surfaces", () => {
  for (const theme of catalogThemes) for (const accent of theme.accentSwatches) {
    const c = resolvePalette({ themeId: theme.id, accentId: accent.id }, fallbackThemeId).tokens;
    for (const background of [c.canvas, c.surface, c.surfaceRaised, c.input, c.navigation]) {
      for (const ink of [c.textPrimary, c.textSecondary, c.textMuted, c.accentInk, c.info, c.success, c.warning, c.danger]) {
        assert.ok(contrastRatio(ink, background) >= 4.5, `${theme.id}/${accent.id}: ${ink}/${background}`);
      }
      for (const ink of [c.iconPrimary, c.iconSecondary, c.focusRing, c.controlBorder]) assert.ok(contrastRatio(ink, background) >= 3);
    }
    assert.ok(contrastRatio(c.onAccentSoft, c.accentSoft) >= 4.5);
    for (const ink of [c.textPrimary, c.textSecondary, c.textMuted, c.accentInk]) assert.ok(contrastRatio(ink, c.accentSoft) >= 4.5);
    assert.ok(contrastRatio(c.onAccentFill, c.accentPressed) >= 4.5);
  }
});

test("week context remains readable across all 18 combinations and keeps semantic statuses", () => {
  for (const theme of catalogThemes) for (const accent of theme.accentSwatches) {
    const c = resolvePalette({ themeId: theme.id, accentId: accent.id }, fallbackThemeId).tokens;
    for (const tone of [c.success, c.warning, c.danger, c.charts[1]]) {
      const tinted = tintPalette(c, tone);
      assert.deepEqual([tinted.success, tinted.warning, tinted.danger, tinted.info], [c.success, c.warning, c.danger, c.info]);
      assert.ok(contrastRatio(tinted.onAccentFill, tinted.accentFill) >= 4.5);
      for (const bg of [tinted.canvas, tinted.surface, tinted.input, tinted.surfaceRaised, tinted.accentSoft]) {
        assert.ok(contrastRatio(tinted.accentInk, bg) >= 4.5, `${theme.id}/${accent.id}/${tone}: contextual ink ${bg}`);
      }
    }
  }
});

function contrastRatio(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((index) => {
    const channel = Number.parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
