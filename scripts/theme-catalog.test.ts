import assert from "node:assert/strict";
import test from "node:test";
import { catalogThemes, catalogSourceSha256 } from "../apps/mobile/src/shared/ui/theme/catalog.generated.ts";
import { resolvePalette } from "../apps/mobile/src/shared/ui/theme/resolver.ts";

const fallbackThemeId = "graphite-teal";

test("runtime snapshot exposes exactly nine themes and 27 allowed combinations", () => {
  assert.match(catalogSourceSha256, /^[0-9a-f]{64}$/u);
  assert.equal(catalogThemes.length, 9);
  assert.equal(new Set(catalogThemes.map((theme) => theme.id)).size, 9);
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
      assert.equal(resolved.tokens.accentInk, accent.resolvedInk);
      assert.equal(resolved.tokens.focusRing, accent.resolvedInk);
      assert.equal(resolved.tokens.charts.length, 4);
      assert.equal(resolved.tokens.success, theme.status.success);
      assert.equal(resolved.tokens.warning, theme.status.warning);
      assert.equal(resolved.tokens.danger, theme.status.danger);
      combinations += 1;
    }
  }
  assert.equal(combinations, 27);
});

test("unknown theme/accent resolves without mutating the stored preference", () => {
  const preference = Object.freeze({ themeId: "deleted-theme", accentId: "deleted-accent" });
  const resolved = resolvePalette(preference, fallbackThemeId);
  assert.equal(resolved.themeId, fallbackThemeId);
  assert.equal(resolved.accentId, "teal");
  assert.equal(resolved.usedThemeFallback, true);
  assert.equal(resolved.usedAccentFallback, true);
  assert.deepEqual(preference, { themeId: "deleted-theme", accentId: "deleted-accent" });
  const slate = resolvePalette({ themeId: "slate-blue", accentId: "crimson" }, fallbackThemeId);
  assert.equal(slate.themeId, "slate-blue");
  assert.equal(slate.accentId, "blue");
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
