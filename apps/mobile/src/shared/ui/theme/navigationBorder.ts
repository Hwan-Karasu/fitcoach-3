import { readableInk } from "./colorAlpha.ts";
import type { PaletteTokens } from "./resolver.ts";

/** Decorative outline stays visible against the bar and page, including week tints. */
export function navigationBorder(tokens: PaletteTokens): string {
  return readableInk(tokens.border, [tokens.canvas, tokens.navigation], tokens.iconSecondary, 1.5);
}
